// 页脚巨型字标的流体扭曲（与前台 AppFooter / useFooterDistortion.js 同一套手感）。
//
// 前台用 three.js 做这件事；admin 不想为一个页脚背上 three（约 600KB）。
// 这里用原生 WebGL 等价重写：
//   · 15×15 位移网格（字节贴图，双线性过滤，格子之间是平滑过渡）
//   · 指针移动时在半径内按速度注入位移，每帧 ×0.88 衰减
//   · 片元着色器按位移偏移 UV，字标贴图在运行时用 2D canvas 画出来
//
// 只在页脚真正露出来时启动 RAF；WebGL 不可用 / 创建失败返回 null，
// 组件会保留 HTML 字标兜底。

const TEXT = 'LIVEINPASSION';
const GRID = 15;
const RADIUS = 0.25;
const STRENGTH = 0.15;
const RELAX = 0.88;
const SHIFT = 0.03;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createFooterDistortion(canvas, { getColor } = {}) {
  if (!canvas) return null;

  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      // 字标是直通 alpha（文字颜色 + 透明底）；premultipliedAlpha 会污染边缘
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (!gl) return null;

  const vs = compile(
    gl,
    gl.VERTEX_SHADER,
    'attribute vec2 aPos; varying vec2 vUv;' +
      'void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }'
  );
  const fs = compile(
    gl,
    gl.FRAGMENT_SHADER,
    'precision mediump float;' +
      'uniform sampler2D uData; uniform sampler2D uTex; varying vec2 vUv;' +
      'void main(){' +
      '  vec2 offset = texture2D(uData, vUv).rg * 2.0 - 1.0;' +
      `  gl_FragColor = texture2D(uTex, vUv - ${SHIFT} * offset);` +
      '}'
  );
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.useProgram(program);

  // 全屏四边形
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // 位移网格：offs 模拟用（-1..1），bytes 给 GPU（128 = 零位移）
  const offs = new Float32Array(GRID * GRID * 2);
  const bytes = new Uint8Array(GRID * GRID * 4);
  for (let i = 0; i < GRID * GRID; i++) {
    bytes[i * 4] = 128;
    bytes[i * 4 + 1] = 128;
    bytes[i * 4 + 3] = 255;
  }

  const dataTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, dataTex);
  for (const [key, value] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ]) {
    gl.texParameteri(gl.TEXTURE_2D, key, value);
  }
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, GRID, GRID, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes
  );

  const wordTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, wordTex);
  for (const [key, value] of [
    [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
    [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ]) {
    gl.texParameteri(gl.TEXTURE_2D, key, value);
  }

  gl.uniform1i(gl.getUniformLocation(program, 'uData'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 1);

  const offscreen = document.createElement('canvas');

  function ensureTexture() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return false;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = (getColor && getColor()) || '#1A1A1A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 把字标铺满整条画布：字号从大到小试，直到宽度塞得下
    let size = h * 1.8;
    for (; size > 8; size -= 2) {
      ctx.font = `700 ${size}px Oswald, "Arial Narrow", sans-serif`;
      if (ctx.measureText(TEXT).width <= w * 0.98) break;
    }
    ctx.font = `700 ${size}px Oswald, "Arial Narrow", sans-serif`;
    ctx.fillText(TEXT, w / 2, h * 0.52);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, wordTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen
    );
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return true;
  }

  function render() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(2, Math.round(w * dpr));
    canvas.height = Math.max(2, Math.round(h * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    ensureTexture();
    render();
  }

  // 指针：记录归一化位置和每帧速度
  const mouse = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };
  function onPointerMove(event) {
    if (event.pointerType !== 'mouse') return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (
      event.clientX < r.left || event.clientX > r.right ||
      event.clientY < r.top || event.clientY > r.bottom
    ) return;
    const x = (event.clientX - r.left) / r.width;
    const y = 1 - (event.clientY - r.top) / r.height;
    mouse.vx = x - mouse.px;
    mouse.vy = y - mouse.py;
    mouse.x = x;
    mouse.y = y;
    mouse.px = x;
    mouse.py = y;
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  let raf = 0;
  let running = false;

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);

    const vx = mouse.vx;
    const vy = mouse.vy;
    mouse.vx = 0;
    mouse.vy = 0;

    for (let i = 0; i < GRID * GRID; i++) {
      offs[i * 2] *= RELAX;
      offs[i * 2 + 1] *= RELAX;
    }

    const gx = mouse.x * GRID;
    const gy = mouse.y * GRID;
    const radius = RADIUS * GRID;
    const r2 = radius * radius;
    if (vx || vy) {
      for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
          const d2 = (gx - x) ** 2 + (gy - y) ** 2;
          if (d2 >= r2) continue;
          const fall = Math.min(radius / Math.max(Math.sqrt(d2), 1), 10);
          const i = (x + y * GRID) * 2;
          offs[i] = Math.max(-1, Math.min(1, offs[i] + 5 * STRENGTH * vx * fall));
          offs[i + 1] = Math.max(-1, Math.min(1, offs[i + 1] - 5 * STRENGTH * vy * fall));
        }
      }
    }

    for (let i = 0; i < GRID * GRID; i++) {
      bytes[i * 4] = Math.round((offs[i * 2] * 0.5 + 0.5) * 255);
      bytes[i * 4 + 1] = Math.round((offs[i * 2 + 1] * 0.5 + 0.5) * 255);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dataTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, GRID, GRID, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes
    );
    render();
  }

  function start() {
    if (running) return;
    if (!ensureTexture()) return;
    running = true;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function redraw() {
    if (!ensureTexture()) return;
    render();
  }

  resize();
  // Oswald 可能还没就绪：字体加载完再画一次
  document.fonts?.ready.then(() => redraw()).catch(() => {});

  return {
    start,
    stop,
    redraw,
    resize,
    dispose() {
      stop();
      window.removeEventListener('pointermove', onPointerMove);
      gl.deleteTexture(dataTex);
      gl.deleteTexture(wordTex);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    },
  };
}
