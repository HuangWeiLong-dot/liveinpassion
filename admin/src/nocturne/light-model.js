// Physically based light model for the sheet of paper.
// From Typewriter Nocturne (Chaosnap/Typewriter-Nocturne 1.2.0, MIT:
// app/nocturne/light-model.ts + lighting-math.ts).
//
// The paper is the plane z = 0 in sheet pixels. Lamps are point lights with a soft-edged cone
// (a spot light) at a height above the paper; moonlight is a directional light through a window.
// Irradiance follows the inverse-square law and Lambert's cosine law:
//
//     E = cone(θ) · max(0, n · l) / d²

export function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Half the width of a glazing bar, in pixels, for panes of this size. */
export const barHalfWidth = (paneWidth, paneHeight) => Math.min(16, Math.max(4, 0.04 * Math.min(paneWidth, paneHeight)));

/** Light passed between two bars along one axis: 0 on a bar, 1 in the pane, blurred by `soft`. */
function between(offset, cell, bar, soft) {
  const t = offset / cell;
  const fromBar = Math.abs(t - Math.round(t)) * cell;
  return smoothstep(bar - soft, bar + soft, fromBar);
}

/** Fraction of moonlight that passes the window frame at a point of the sheet. */
export function windowGobo(rig, x, y) {
  const w = rig.window;
  const soft = Math.max(0.5, w.softness);
  const sx = x - (y - w.y) * w.skew;
  const dx = sx - w.x;
  const dy = y - w.y;
  const across = smoothstep(-soft, soft, w.width / 2 - Math.abs(dx));
  const down = smoothstep(-soft, soft, w.height / 2 - Math.abs(dy));
  const paneWidth = w.width / w.columns;
  const paneHeight = w.height / w.rows;
  const bar = barHalfWidth(paneWidth, paneHeight);
  const open = between(dx + w.width / 2, paneWidth, bar, soft) * between(dy + w.height / 2, paneHeight, bar, soft);
  return across * down * (0.3 + 0.7 * open);
}

/** Irradiance (before exposure) at sheet point (x, y) for a paper normal. */
export function irradiance(rig, x, y, normal = [0, 0, 1]) {
  if (rig.source === 'moonlight') {
    const toLight = [-rig.direction[0], -rig.direction[1], -rig.direction[2]];
    return Math.max(0, normal[0] * toLight[0] + normal[1] * toLight[1] + normal[2] * toLight[2]) * windowGobo(rig, x, y);
  }
  const toPoint = [x - rig.position[0], y - rig.position[1], -rig.position[2]];
  const distanceSquared = Math.max(1, toPoint[0] * toPoint[0] + toPoint[1] * toPoint[1] + toPoint[2] * toPoint[2]);
  const ray = normalize(toPoint);
  const cone = smoothstep(rig.cosOuter, rig.cosInner, ray[0] * rig.direction[0] + ray[1] * rig.direction[1] + ray[2] * rig.direction[2]);
  const lambert = Math.max(0, -(normal[0] * ray[0] + normal[1] * ray[1] + normal[2] * ray[2]));
  return (cone * lambert) / distanceSquared;
}

/** Exposure tone mapping to a light amount in [0, 1). */
export const toneMap = (value) => 1 - Math.exp(-Math.max(0, value));

/** Light amount in [0, 1) at a sheet point. */
export const lightAmount = (rig, x, y, normal) => toneMap(irradiance(rig, x, y, normal) * rig.exposure);

/** Converts a beam angle in degrees to the half-angle cosine used by the shader. */
export const spreadToCosine = (degrees) => Math.cos((Math.min(170, Math.max(5, degrees)) * Math.PI) / 360);

/** Builds the light rig for the current theme and sheet geometry. */
export function buildRig(lighting, theme, sheet) {
  const source = lighting.source === 'theme' ? theme.light.source : lighting.source;
  const {width, height} = sheet;
  const halfAngle = Math.acos(spreadToCosine(lighting.spread));
  const cosOuter = Math.cos(halfAngle);
  const cosInner = Math.cos(halfAngle * (1 - 0.85 * lighting.softness));
  const position = lighting.source === 'theme' ? theme.light.position : lighting.position;
  const base = {
    source,
    position: [0, 0, 1],
    direction: [0, 0, -1],
    cosOuter,
    cosInner,
    exposure: 1,
    window: {x: width / 2, y: height / 2, width, height, columns: 3, rows: 2, softness: 8, skew: 0}
  };

  let rig;
  let referenceIrradiance;
  const swivel = (Math.max(-45, Math.min(45, lighting.aim)) * Math.PI) / 180;

  if (source === 'carriage') {
    // A small lamp on the carriage, just above the paper, shining up the page.
    const lamp = [sheet.headX, sheet.railY, 12 + 0.02 * height];
    const throwLength = 0.6 * lighting.reach * height;
    const aim = [sheet.headX + Math.tan(swivel) * throwLength, sheet.railY - throwLength, 0];
    rig = {...base, position: lamp, direction: normalize([aim[0] - lamp[0], aim[1] - lamp[1], aim[2] - lamp[2]])};
    const referenceLength = 0.5 * lighting.reach * height;
    const reference = [sheet.headX + Math.tan(swivel) * referenceLength, sheet.railY - referenceLength];
    referenceIrradiance = irradiance(rig, reference[0], reference[1]);
  } else if (source === 'desk-lamp') {
    // An overhead desk lamp, higher for a longer reach, aimed at the middle of the page.
    const lamp = [position.x * width, position.y * height, (0.3 + 0.4 * lighting.reach) * height];
    const dx = width * 0.5 - lamp[0];
    const dy = height * 0.55 - lamp[1];
    const cos = Math.cos(swivel);
    const sin = Math.sin(swivel);
    const aim = [lamp[0] + dx * cos - dy * sin, lamp[1] + dx * sin + dy * cos, 0];
    rig = {...base, position: lamp, direction: normalize([aim[0] - lamp[0], aim[1] - lamp[1], aim[2] - lamp[2]])};
    referenceIrradiance = irradiance(rig, aim[0], aim[1]);
  } else {
    // Moonlight: parallel rays at 40° elevation from the moon's side, through a window frame.
    const azimuth = Math.atan2(0.5 - position.y, 0.5 - position.x) + swivel;
    const elevation = (40 * Math.PI) / 180;
    const direction = normalize([
      Math.cos(azimuth) * Math.cos(elevation),
      Math.sin(azimuth) * Math.cos(elevation),
      -Math.sin(elevation)
    ]);
    const frame = lighting.window;
    const pane = Math.max(60, (Math.min(width * 0.62, height * 0.7) * lighting.reach) / 2);
    rig = {
      ...base,
      direction,
      window: {
        x: width * frame.x,
        y: height * frame.y,
        width: pane * frame.columns,
        height: pane * frame.rows,
        columns: frame.columns,
        rows: frame.rows,
        softness: 4 + 40 * lighting.softness,
        skew: Math.tan((Math.max(-35, Math.min(35, frame.slant)) * Math.PI) / 180)
      }
    };
    referenceIrradiance = Math.max(0, -direction[2]);
  }

  return {...rig, exposure: referenceIrradiance > 0 ? lighting.intensity / referenceIrradiance : 0};
}

/** CSS hex colour → 0–1 per channel. */
export function toUnit(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}
