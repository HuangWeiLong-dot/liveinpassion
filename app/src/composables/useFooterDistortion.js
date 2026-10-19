// footer 巨型字标的流体扭曲（参照 trae.cn 的 grid-distortion）。
//
// 参考站的做法：
//   · 底部那条大字标是一个 **fixed 的画布**，页面内容盖在它上面；
//     页脚里留一块同高的占位，滚到页尾时占位让开，画布才露出来。
//   · 字标不是普通文字，而是一张贴图；画布用 15×15 的位移网格采样它。
//   · 指针移动时，在半径 0.25（网格单位）内按指针速度注入位移脉冲；
//     每帧 ×0.9 衰减，片元着色器按位移偏移 UV。
//
// 我们只保留这套手感，字标贴图在运行时用 canvas 画出来（LIVEINPASSION），
// 这样主题切换时只要重画贴图，不用准备额外资源。

const TEXT = 'LIVEINPASSION';
const GRID = 15;
const RADIUS = 0.25;
const STRENGTH = 0.15;
const RELAX = 0.88;
const SHIFT = 0.03;

export async function createFooterDistortion(canvas, { getColor, onReady } = {}) {
  if (!canvas) return null;
  let THREE;
  try {
    THREE = await import('three');
  } catch {
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // canvas 里的字是"直通 alpha"（文字颜色 + 透明背景）；默认的
      // premultipliedAlpha 会把边缘半透明像素当成已经乘过 alpha，
      // 字边就会出现一圈毛刺/锯齿。显式关掉，让浏览器按 straight alpha 合成。
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
  } catch {
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 15×15 的位移网格。用 **字节** 而不是浮点贴图：字节贴图在所有设备上
  // 都能做双线性过滤，格子之间是平滑过渡；浮点贴图在很多设备上只能最近邻，
  // 画面会变成一块一块的阶梯。
  //   offs：模拟用（-1..1），bytes：给 GPU 的编码（128 = 零位移）
  const offs = new Float32Array(GRID * GRID * 2);
  const bytes = new Uint8Array(GRID * GRID * 4);
  for (let i = 0; i < GRID * GRID; i++) {
    bytes[i * 4] = 128;
    bytes[i * 4 + 1] = 128;
    bytes[i * 4 + 3] = 255;
  }
  const dataTex = new THREE.DataTexture(bytes, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
  dataTex.minFilter = THREE.LinearFilter;
  dataTex.magFilter = THREE.LinearFilter;
  dataTex.needsUpdate = true;

  let wordTex = null;

  function makeWordTexture() {
    const w = Math.max(2, Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)));
    const h = Math.max(2, Math.round(canvas.clientHeight * Math.min(window.devicePixelRatio || 1, 2)));
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
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

    const tex = new THREE.CanvasTexture(off);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }

  function ensureTexture() {
    const next = makeWordTexture();
    if (wordTex) wordTex.dispose();
    wordTex = next;
    material.uniforms.uTex.value = wordTex;
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uData: { value: dataTex },
      uTex: { value: null },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uData;
      uniform sampler2D uTex;
      varying vec2 vUv;
      void main() {
        // 字节贴图：0..1 解码回 -1..1
        vec2 offset = texture2D(uData, vUv).rg * 2.0 - 1.0;
        gl_FragColor = texture2D(uTex, vUv - ${SHIFT} * offset);
      }
    `,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    ensureTexture();
    renderer.render(scene, camera);
  }

  // 指针：记录归一化位置和每帧速度
  const mouse = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0 };
  function onPointerMove(event) {
    if (event.pointerType !== 'mouse') return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (event.clientX < r.left || event.clientX > r.right
      || event.clientY < r.top || event.clientY > r.bottom) return;
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

    // 1) 衰减；2) 在指针半径内按速度注入脉冲（限制在 -1..1）
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

    // 3) 编码给 GPU（128 = 0）
    for (let i = 0; i < GRID * GRID; i++) {
      bytes[i * 4] = Math.round((offs[i * 2] * 0.5 + 0.5) * 255);
      bytes[i * 4 + 1] = Math.round((offs[i * 2 + 1] * 0.5 + 0.5) * 255);
    }
    dataTex.needsUpdate = true;
    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    if (!wordTex) ensureTexture();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function redraw() {
    ensureTexture();
    renderer.render(scene, camera);
  }

  ensureTexture();
  resize();
  // Oswald 可能还没就绪：字体加载完再画一次，避免第一帧是回退字体
  document.fonts?.ready.then(() => redraw()).catch(() => {});
  onReady?.();

  return {
    start,
    stop,
    redraw,
    resize,
    dispose() {
      stop();
      window.removeEventListener('pointermove', onPointerMove);
      wordTex?.dispose();
      dataTex.dispose();
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
