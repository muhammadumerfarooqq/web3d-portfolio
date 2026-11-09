// Particles. Dust/sand motes are a compute-shader simulation (TSL compute: wind + curl-like noise,
// wrapped around the player) when the backend runs compute; otherwise the same look is produced by a
// stateless GPU animation. Fireflies, forge embers and chimney smoke are stateless instanced sprites;
// footstep puffs are a small CPU-fed pool. Every system is one draw call.
import { AdditiveBlending, Color, InstancedBufferAttribute, NormalBlending, Sprite, SpriteNodeMaterial, Vector3 } from 'three/webgpu';
import {
  Fn,
  clamp,
  deltaTime,
  float,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  instancedBufferAttribute,
  length,
  mix,
  mod,
  mrt,
  mx_noise_float,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';

const softDot = (power = 1.5) => smoothstep(0.5, 0.0, length(uv().sub(0.5))).pow(power);

function sprite(material, count, name) {
  const s = new Sprite(material);
  s.count = count;
  s.frustumCulled = false;
  s.name = name;
  return s;
}

export function createParticles({ scene, renderer, settings, backend, chimneys, forge, heightAt }) {
  const shared = {
    center: uniform(new Vector3()),
    wind: uniform(new Vector3(1.2, 0, 0.4)),
    night: uniform(1),
    day: uniform(0),
    sunColor: uniform(new Color(1, 0.6, 0.3)),
    now: uniform(0),
  };
  const objects = [];
  const emissiveTargets = []; // { material, node } routed into the emissive MRT when it exists
  const computeNodes = [];

  // ── Dust / sand motes ──
  const N = settings.particles;
  const HALF = vec3(28, 3, 28);
  const dustMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  let computeUpdate = null;
  let computeInit = null;
  let dustMode = 'stateless';
  if (backend === 'webgpu') {
    const pos = instancedArray(N, 'vec3');
    const vel = instancedArray(N, 'vec3');
    computeInit = Fn(() => {
      const i = float(instanceIndex);
      pos.element(instanceIndex).assign(shared.center.add(vec3(hash(i).sub(0.5).mul(56), hash(i.add(7.1)).mul(6), hash(i.add(13.7)).sub(0.5).mul(56))));
      vel.element(instanceIndex).assign(vec3(0));
    })().compute(N);
    computeUpdate = Fn(() => {
      const p = pos.element(instanceIndex);
      const v = vel.element(instanceIndex);
      const q = p.mul(0.12).add(vec3(0, 0, time.mul(0.15)));
      const turbulence = vec3(mx_noise_float(q), mx_noise_float(q.add(31.7)).mul(0.35), mx_noise_float(q.add(73.1)));
      v.assign(mix(v, shared.wind.add(turbulence.mul(1.4)), 0.035));
      p.addAssign(v.mul(deltaTime));
      // wrap inside a 56 × 6 × 56 m box that follows the player
      const base = shared.center.add(vec3(0, 3, 0));
      p.assign(base.add(mod(p.sub(base).add(HALF), HALF.mul(2)).sub(HALF)));
    })().compute(N);
    dustMat.positionNode = pos.toAttribute();
    dustMode = 'compute';
  } else {
    const i = float(instanceIndex);
    const seed = vec3(hash(i), hash(i.add(7.1)), hash(i.add(13.7)));
    const drift = shared.wind.mul(time).add(vec3(sin(time.mul(0.4).add(seed.x.mul(40))), sin(time.mul(0.6).add(seed.y.mul(40))).mul(0.3), sin(time.mul(0.5).add(seed.z.mul(40)))));
    const base = shared.center.add(vec3(0, 3, 0));
    const world = seed.sub(0.5).mul(HALF.mul(2)).add(drift);
    dustMat.positionNode = base.add(mod(world.sub(base).add(HALF), HALF.mul(2)).sub(HALF));
  }
  const dustSize = hash(float(instanceIndex).add(3.3)).mul(0.035).add(0.012);
  dustMat.scaleNode = dustSize;
  // Golden motes in the low sun, pale blue specks in the moonlight.
  dustMat.colorNode = mix(vec3(shared.sunColor).mul(1.6), vec3(0.45, 0.55, 0.85), shared.night);
  dustMat.opacityNode = softDot(1.2).mul(mix(0.55, 0.22, shared.night));
  const dust = sprite(dustMat, N, 'explore_dust');
  objects.push(dust);

  // ── Fireflies (night) ──
  const FF = Math.max(60, Math.round(N / 18));
  const ffMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  {
    const i = float(instanceIndex);
    const seed = vec3(hash(i.add(1.1)), hash(i.add(2.2)), hash(i.add(3.3)));
    const wander = vec3(sin(time.mul(seed.x.mul(0.6).add(0.2)).add(seed.y.mul(30))).mul(1.6), sin(time.mul(seed.z.mul(0.9).add(0.3))).mul(0.5), sin(time.mul(seed.y.mul(0.7).add(0.25)).add(seed.x.mul(20))).mul(1.6));
    const box = vec3(36, 1, 36);
    const local = seed.sub(0.5).mul(box.mul(2)).add(wander);
    const base = shared.center.add(vec3(0, 1.3, 0));
    ffMat.positionNode = base.add(mod(local.sub(base).add(box), box.mul(2)).sub(box));
    const pulse = smoothstep(0.35, 1.0, sin(time.mul(seed.x.mul(2.0).add(1.0)).add(seed.z.mul(50))).mul(0.5).add(0.5));
    ffMat.scaleNode = float(0.07);
    const glow = vec3(1.0, 0.85, 0.35).mul(pulse).mul(shared.night).mul(5.0);
    ffMat.colorNode = glow;
    ffMat.opacityNode = softDot(2.0).mul(pulse).mul(shared.night);
    emissiveTargets.push({ material: ffMat, node: glow.mul(softDot(2.0)) });
  }
  objects.push(sprite(ffMat, FF, 'explore_fireflies'));

  // ── Forge embers (blacksmith) ──
  if (forge) {
    const EM = 90;
    const emMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const i = float(instanceIndex);
    const seed = vec3(hash(i.add(9.1)), hash(i.add(8.2)), hash(i.add(7.3)));
    const life = fract(time.mul(seed.x.mul(0.25).add(0.18)).add(seed.y));
    const origin = uniform(forge.clone());
    emMat.positionNode = origin.add(vec3(sin(life.mul(6).add(seed.z.mul(20))).mul(0.4).add(seed.x.sub(0.5)), life.mul(4.5), seed.z.sub(0.5).mul(0.8))).add(shared.wind.mul(life).mul(0.6));
    emMat.scaleNode = mix(0.06, 0.015, life);
    const c = vec3(1.0, 0.45, 0.08).mul(float(1).sub(life)).mul(4.0);
    emMat.colorNode = c;
    emMat.opacityNode = softDot(1.5).mul(float(1).sub(life));
    emissiveTargets.push({ material: emMat, node: c.mul(softDot(1.5)) });
    objects.push(sprite(emMat, EM, 'explore_embers'));
  }

  // ── Chimney smoke ──
  for (const [k, origin] of chimneys.entries()) {
    const SM = 36;
    const smMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending });
    const i = float(instanceIndex);
    const seed = hash(i.add(k * 17.0));
    const life = fract(time.mul(0.06).add(seed));
    const o = uniform(origin.clone());
    smMat.positionNode = o.add(vec3(sin(life.mul(5).add(seed.mul(30))).mul(0.4), life.mul(9.0), 0)).add(shared.wind.mul(life.mul(life)).mul(4.0));
    smMat.scaleNode = mix(0.5, 3.4, life);
    smMat.colorNode = mix(vec3(0.55, 0.47, 0.42), vec3(0.18, 0.2, 0.3), shared.night);
    smMat.opacityNode = softDot(1.0).mul(sin(life.mul(Math.PI))).mul(0.28).mul(mx_noise_float(vec3(uv().mul(3), life.mul(4).add(seed))).mul(0.4).add(0.8));
    objects.push(sprite(smMat, SM, `explore_smoke_${k}`));
  }

  // ── Footstep dust puffs (CPU-fed ring buffer) ──
  const PUFFS = 24;
  const puffData = new Float32Array(PUFFS * 4).fill(-100);
  const puffAttr = new InstancedBufferAttribute(puffData, 4);
  const pd = instancedBufferAttribute(puffAttr);
  const puffMat = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: NormalBlending });
  {
    const age = shared.now.sub(pd.w);
    const t = clamp(age.div(0.9), 0, 1);
    const seed = hash(float(instanceIndex).add(5.5));
    puffMat.positionNode = pd.xyz.add(vec3(seed.sub(0.5).mul(0.3), t.mul(0.35).add(0.05), hash(float(instanceIndex)).sub(0.5).mul(0.3)));
    puffMat.scaleNode = t.mul(0.55).add(0.18);
    puffMat.colorNode = mix(vec3(0.72, 0.52, 0.34), vec3(0.3, 0.3, 0.42), shared.night);
    puffMat.opacityNode = softDot(1.0).mul(float(1).sub(t)).mul(smoothstep(0.0, 0.05, age)).mul(0.38);
  }
  objects.push(sprite(puffMat, PUFFS, 'explore_puffs'));
  let puffHead = 0;

  for (const o of objects) scene.add(o);

  let computeReady = false;
  return {
    shared,
    emissiveTargets,
    dustMode,
    setEmissiveMrt(on) {
      for (const t of emissiveTargets) {
        t.material.mrtNode = on ? mrt({ emissive: t.node }) : null;
        t.material.needsUpdate = true;
      }
    },
    puff(x, y, z) {
      const i = puffHead * 4;
      puffData[i] = x;
      puffData[i + 1] = y;
      puffData[i + 2] = z;
      puffData[i + 3] = shared.now.value;
      puffHead = (puffHead + 1) % PUFFS;
      puffAttr.needsUpdate = true;
    },
    async update(center, elapsed) {
      shared.center.value.copy(center);
      shared.now.value = elapsed;
      if (computeUpdate) {
        try {
          if (!computeReady) {
            await renderer.computeAsync(computeInit);
            computeReady = true;
          }
          renderer.compute(computeUpdate);
        } catch {
          computeUpdate = null; // keep running without the simulation
        }
      }
    },
    dispose() {
      for (const o of objects) {
        o.removeFromParent();
        o.geometry?.dispose();
        o.material.dispose();
      }
      computeInit?.dispose?.();
      computeUpdate?.dispose?.();
    },
  };
}
