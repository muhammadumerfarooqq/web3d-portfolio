// Case Closed fireworks (lazy chunk, loaded only at 8/8). GPU particles: every spark is one instance
// of a single sprite draw call; the CPU writes each spark's burst (centre, start time, colour, speed,
// direction) once, and the vertex stage animates it from a time uniform (drag + gravity, fading
// trails). A rocket streak rises before each burst. Under reduced motion there is no movement at all:
// a few still, soft glows hang over the town and fade.
import { AdditiveBlending, InstancedBufferAttribute, Sprite, SpriteNodeMaterial, Vector3 } from 'three/webgpu';
import { exp, float, instancedBufferAttribute, length, mix, mrt, select, sin, smoothstep, uniform, uv, vec3 } from 'three/tsl';

const COLOURS = [
  [1.0, 0.62, 0.18], // lantern gold
  [0.95, 0.38, 0.22], // rust
  [1.0, 0.86, 0.55], // cream
  [0.45, 0.75, 1.0], // moon blue
  [0.55, 0.95, 0.6], // forest
];
const PER_BURST = 150;
const LIFE = 2.4;
const RISE = 0.8;

/** Burst plan (pure): when and where each shell bursts, relative to `origin`. */
export function planBursts(count = 8, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return Array.from({ length: count }, (_, i) => ({
    t: 0.2 + i * 0.62 + rnd() * 0.25,
    offset: [(rnd() - 0.5) * 28, 8 + rnd() * 6, (rnd() - 0.5) * 10],
    colour: COLOURS[i % COLOURS.length],
    speed: 7 + rnd() * 4,
  }));
}

export function createFireworks({ scene, origin, reducedMotion = false, audio, emissiveMrt = false }) {
  const now = uniform(0);
  const fade = uniform(1);
  const bursts = planBursts();
  const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const soft = (p) => smoothstep(0.5, 0.0, length(uv().sub(0.5))).pow(p);
  let count;
  let emissiveNode;

  if (reducedMotion) {
    // Still glows: one large soft sprite per burst, no motion.
    count = bursts.length;
    const p = new Float32Array(count * 4);
    const q = new Float32Array(count * 4);
    bursts.forEach((b, i) => {
      p.set([origin.x + b.offset[0], origin.y + b.offset[1], origin.z + b.offset[2], 0], i * 4);
      q.set([...b.colour, 0], i * 4);
    });
    const pos = instancedBufferAttribute(new InstancedBufferAttribute(p, 4));
    const col = instancedBufferAttribute(new InstancedBufferAttribute(q, 4));
    material.positionNode = pos.xyz;
    material.scaleNode = float(7);
    const c = col.xyz.mul(1.6).mul(fade);
    material.colorNode = c;
    material.opacityNode = soft(2.2).mul(fade).mul(0.55);
    emissiveNode = c.mul(soft(2.2)).mul(0.5);
  } else {
    count = bursts.length * PER_BURST;
    // per spark: centre.xyz + start | colour.rgb + speed | direction.xyz + rocket flag
    const d0 = new Float32Array(count * 4);
    const d1 = new Float32Array(count * 4);
    const d2 = new Float32Array(count * 4);
    let k = 0;
    for (const b of bursts) {
      for (let j = 0; j < PER_BURST; j += 1) {
        // Even directions on a sphere (Fibonacci), jittered.
        const y = 1 - (2 * (j + 0.5)) / PER_BURST;
        const r = Math.sqrt(1 - y * y);
        const phi = j * 2.39996 + b.t * 7;
        const jitter = 0.85 + Math.random() * 0.3;
        d0.set([origin.x + b.offset[0], origin.y + b.offset[1], origin.z + b.offset[2], b.t], k * 4);
        d1.set([...b.colour, b.speed * jitter], k * 4);
        d2.set([Math.cos(phi) * r, y, Math.sin(phi) * r, j === 0 ? 1 : 0], k * 4);
        k += 1;
      }
    }
    const a0 = instancedBufferAttribute(new InstancedBufferAttribute(d0, 4));
    const a1 = instancedBufferAttribute(new InstancedBufferAttribute(d1, 4));
    const a2 = instancedBufferAttribute(new InstancedBufferAttribute(d2, 4));
    const centre = a0.xyz;
    const age = now.sub(a0.w);
    const rocket = a2.w;
    const life = age.div(LIFE).clamp(0, 1);
    // Burst: exponential drag on the initial speed, plus gravity.
    const travel = a1.w.mul(float(1).sub(exp(age.max(0).mul(-1.9)))).div(1.9);
    const burstPos = centre.add(a2.xyz.mul(travel)).add(vec3(0, age.max(0).pow(2).mul(-1.4), 0));
    // Rocket: rises from below the burst point during the RISE seconds before it.
    const riseK = age.add(RISE).div(RISE).clamp(0, 1);
    const rocketPos = centre.sub(vec3(0, float(1).sub(riseK).mul(centre.y.sub(origin.y).sub(1)), 0));
    const isRising = rocket.mul(smoothstep(-RISE, -RISE + 0.05, age)).mul(float(1).sub(smoothstep(-0.02, 0.0, age)));
    material.positionNode = select(age.lessThan(0), rocketPos, burstPos);
    const sparkle = sin(age.mul(38).add(a2.x.mul(50))).mul(0.25).add(0.75);
    const burstAlpha = smoothstep(0.0, 0.03, age).mul(float(1).sub(life).pow(1.6)).mul(sparkle);
    const alpha = select(age.lessThan(0), isRising, burstAlpha).mul(fade);
    material.scaleNode = select(age.lessThan(0), float(0.22), mix(0.32, 0.12, life));
    const hot = mix(vec3(1.0, 0.95, 0.85), a1.xyz, smoothstep(0.0, 0.25, life));
    const c = hot.mul(3.2).mul(alpha);
    material.colorNode = c;
    material.opacityNode = soft(1.6).mul(alpha);
    emissiveNode = c.mul(soft(1.6));
  }

  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.name = 'explore_fireworks';
  scene.add(sprite);

  const setEmissiveMrt = (on) => {
    material.mrtNode = on ? mrt({ emissive: emissiveNode }) : null;
    material.needsUpdate = true;
  };
  setEmissiveMrt(emissiveMrt);

  // Sound: a whoosh as each rocket rises, then a thump and a crackle at the burst.
  const timers = bursts.map((b) =>
    setTimeout(() => {
      if (reducedMotion) return;
      audio?.noise({ type: 'bandpass', freq: 2400, q: 0.6, gain: 0.05, decay: RISE * 0.9 });
      audio?.noise({ type: 'lowpass', freq: 140, q: 0.8, gain: 0.45, decay: 0.5, at: RISE });
      for (let i = 0; i < 6; i += 1) audio?.noise({ type: 'highpass', freq: 3200, q: 0.7, gain: 0.08, decay: 0.04, at: RISE + 0.25 + i * 0.07 + Math.random() * 0.05 });
    }, Math.max(0, (b.t - RISE) * 1000)),
  );

  const duration = bursts[bursts.length - 1].t + LIFE + 0.5;
  let t = 0;
  return {
    duration,
    get done() {
      return t >= duration + 1.5;
    },
    update(dt) {
      t += dt;
      now.value = t;
      // Still glows (reduced motion) fade out at the end instead of moving.
      fade.value = reducedMotion ? Math.min(1, t / 0.6) * Math.min(1, Math.max(0, (duration + 1.5 - t) / 1.5)) : 1;
    },
    setEmissiveMrt,
    dispose() {
      for (const id of timers) clearTimeout(id);
      scene.remove(sprite);
      material.dispose();
      sprite.geometry?.dispose?.();
    },
  };
}

/** Where to put the show: ahead of the camera, above the street. */
export function showOrigin(camera, player) {
  const dir = new Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  dir.normalize();
  return new Vector3(player.x + dir.x * 42, player.y, player.z + dir.z * 42);
}
