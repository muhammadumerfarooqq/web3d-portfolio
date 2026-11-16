// Time of day (pure, unit-tested). t = 0 is golden hour (never flat noon), t = 1 is night (the hero
// look). Every value the scene needs is interpolated from two hand-tuned palettes.
// Colours are linear RGB triplets; directions are unit vectors pointing TOWARDS the light.

const normalize = ([x, y, z]) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/** Golden hour: low warm sun from the west-south-west, long shadows, warm haze. */
export const DAY = {
  sunDir: normalize([-0.72, 0.2, 0.42]),
  sunColor: [1.0, 0.62, 0.32],
  sunIntensity: 3.2,
  hemiSky: [0.55, 0.52, 0.62],
  hemiGround: [0.42, 0.25, 0.12],
  hemiIntensity: 0.85,
  skyZenith: [0.16, 0.27, 0.52],
  skyHorizon: [1.0, 0.58, 0.32],
  fogColor: [0.92, 0.58, 0.36],
  fogDensity: 0.0042,
  heightFog: 0.3,
  exposure: 1.0,
  bloomStrength: 0.28,
  lanternIntensity: 0,
  windowGlow: 0.25,
  stars: 0,
  moon: 0,
  wetness: 0,
  fireflies: 0,
  crickets: 0,
  grade: 0, // 0 = warm golden grade, 1 = teal-orange night grade
};

/**
 * Night: deep indigo shadows, amber lantern pools, glowing windows, stars and moon. P3.4: the moon,
 * the sky fill and the exposure are lifted, and the horizon and fog are a touch lighter than the
 * buildings, so the town, the mesas and the lighthouse read as silhouettes from the dock and the shore
 * (it was too dark away from the street); the lanterns stay the warmest, brightest thing.
 */
export const NIGHT = {
  sunDir: normalize([0.35, 0.36, -0.7]), // the moon: low, ahead-right of the dock, so its glitter path runs beside it
  sunColor: [0.55, 0.66, 1.0],
  sunIntensity: 0.85,
  hemiSky: [0.17, 0.2, 0.4],
  hemiGround: [0.08, 0.06, 0.07],
  hemiIntensity: 0.8,
  skyZenith: [0.01, 0.014, 0.05],
  skyHorizon: [0.1, 0.1, 0.22],
  fogColor: [0.075, 0.085, 0.18],
  fogDensity: 0.0105,
  heightFog: 0.75,
  exposure: 1.22,
  bloomStrength: 0.6,
  lanternIntensity: 1,
  windowGlow: 1,
  stars: 1,
  moon: 1,
  wetness: 1,
  fireflies: 1,
  crickets: 1,
  grade: 1,
};

/** Smooth ease used for the ~2 s day/night switch. */
export const ease = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

const mixNum = (a, b, t) => a + (b - a) * t;
const mixArr = (a, b, t) => a.map((v, i) => mixNum(v, b[i], t));

/** The full palette at t ∈ [0, 1] (0 = golden hour, 1 = night). */
export function timeOfDay(t) {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const out = {};
  for (const key of Object.keys(DAY)) {
    const a = DAY[key];
    const b = NIGHT[key];
    out[key] = Array.isArray(a) ? mixArr(a, b, k) : mixNum(a, b, k);
  }
  // Light direction swings between sun and moon through the horizon, never under the ground.
  out.sunDir = normalize(mixArr(DAY.sunDir, NIGHT.sunDir, k));
  out.sunDir[1] = Math.max(0.08, out.sunDir[1]);
  out.sunDir = normalize(out.sunDir);
  out.t = k;
  return out;
}

/** Animate t towards a target over `duration` seconds with the ease above. Returns the new state. */
export function stepTransition(state, dt, duration = 2) {
  if (state.progress >= 1) return { ...state, t: state.to, progress: 1, done: true };
  const progress = Math.min(1, state.progress + dt / duration);
  return { ...state, progress, t: mixNum(state.from, state.to, ease(progress)), done: progress >= 1 };
}

export const startTransition = (fromT, toT) => ({ from: fromT, to: toT, progress: 0, t: fromT, done: false });
