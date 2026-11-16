// Riding maths (pure, unit-tested). W steps the gait up (Walk → Trot → Gallop) and the horse holds
// it; S steps it down, and held at a standstill backs up at walk speed. A / D turn: the turn radius
// grows with speed (tight at a walk, wide at a gallop). No jumping. Speeds come from horse.json.

export const GAITS = ['Idle', 'Walk', 'Trot', 'Gallop'];
const FALLBACK = { Walk: 1.6, Trot: 3.5, Gallop: 8 };

/** horse.json gaits ("~1.6 m/s") → { Walk, Trot, Gallop } in m/s. */
export function parseGaitSpeeds(json) {
  const out = { ...FALLBACK };
  for (const g of ['Walk', 'Trot', 'Gallop']) {
    const v = Number.parseFloat(String(json?.gaits?.[g] ?? '').replace(/[^\d.]/g, ''));
    if (Number.isFinite(v) && v > 0 && v < 30) out[g] = v;
  }
  return out;
}

/** Turn radius in metres at speed v: R = 1 + 0.8·|v| (1.0 m on the spot, ~7.4 m at a gallop). */
export const turnRadius = (v) => 1 + 0.8 * Math.abs(v);

/** Yaw rate (rad/s) for steer ∈ [-1, 1]: on the spot it pivots at 1 rad/s; moving, ω = v / R(v). */
export function yawRate(v, steer) {
  if (Math.abs(v) < 0.3) return steer * 1.0;
  return steer * Math.sign(v) * Math.min(1.4, Math.abs(v) / turnRadius(v));
}

/** Which clip to play at this ground speed. */
export function gaitFor(speed, speeds) {
  const s = Math.abs(speed);
  if (s < 0.25) return 'Idle';
  if (s < (speeds.Walk + speeds.Trot) / 2) return 'Walk';
  if (s < (speeds.Trot + speeds.Gallop) / 2) return 'Trot';
  return 'Gallop';
}

export function createRide(speeds) {
  return { level: 0, speed: 0, holdF: 0, holdB: 0, speeds };
}

const STEP_HOLD = 0.45; // holding W / S steps one gait per 0.45 s

/** One frame: input { forward, back, steer } → mutates and returns the ride state (+ yawRate). */
export function rideStep(st, input, dt) {
  const { speeds } = st;
  if (input.forward) {
    if (st.holdF === 0 || st.holdF >= STEP_HOLD) {
      st.level = Math.min(3, Math.max(st.level, 0) + 1);
      st.holdF = 1e-6;
    }
    st.holdF += dt;
  } else st.holdF = 0;
  if (input.back) {
    if (st.holdB === 0 || st.holdB >= STEP_HOLD) {
      st.level = Math.max(st.level > 0 ? 0 : -1, st.level - 1);
      st.holdB = 1e-6;
    }
    st.holdB += dt;
  } else {
    st.holdB = 0;
    if (st.level < 0) st.level = 0; // reversing only while S is held
  }
  const target = st.level > 0 ? speeds[GAITS[st.level]] : st.level < 0 ? -speeds.Walk : 0;
  const rate = Math.abs(target) > Math.abs(st.speed) && Math.sign(target || 1) === Math.sign(st.speed || target || 1) ? 3.5 : 6;
  const d = target - st.speed;
  st.speed += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  st.yawRate = yawRate(st.speed, input.steer ?? 0);
  st.gait = gaitFor(st.speed, speeds);
  return st;
}

/** Stop dead (a wall, the water's edge). */
export function halt(st) {
  st.speed = 0;
  st.level = 0;
  return st;
}
