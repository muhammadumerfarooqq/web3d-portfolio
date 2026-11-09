// Sky dome: gradient, sun disc with glow (golden hour), moon with soft craters and halo, twinkling
// stars (night only, no aurora), and thin drifting clouds lit by the sun. The sun disc, moon and stars
// write to the emissive MRT channel so the selective bloom picks them up.
import { BackSide, Color, Mesh, MeshBasicNodeMaterial, SphereGeometry } from 'three/webgpu';
import {
  Fn,
  abs,
  dot,
  floor,
  fract,
  hash,
  length,
  max,
  mix,
  mrt,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';

export function createSky() {
  const u = {
    zenith: uniform(new Color(0.01, 0.01, 0.04)),
    horizon: uniform(new Color(0.07, 0.07, 0.17)),
    sunDir: uniform(new Color(0.4, 0.6, -0.3)),
    sunColor: uniform(new Color(1, 0.6, 0.3)),
    day: uniform(0),
    stars: uniform(1),
    moon: uniform(1),
    groundColor: uniform(new Color(0.05, 0.06, 0.14)),
  };

  const dir = normalize(positionLocal);
  const sunDir = normalize(vec3(u.sunDir));

  const gradient = Fn(() => {
    const h = dir.y;
    const up = pow(smoothstep(-0.02, 0.7, h), 0.55);
    const sky = mix(vec3(u.horizon), vec3(u.zenith), up);
    // warm band hugging the horizon at golden hour
    const band = smoothstep(0.25, 0.0, abs(h)).mul(u.day).mul(0.35);
    const below = smoothstep(0.0, -0.12, h);
    return mix(sky.add(vec3(u.sunColor).mul(band)), vec3(u.groundColor), below);
  });

  const sun = Fn(() => {
    const d = max(dot(dir, sunDir), 0.0);
    const disc = smoothstep(0.99935, 0.99965, d).mul(u.day).mul(18.0);
    const glow = pow(d, 900.0).mul(3.0).add(pow(d, 48.0).mul(0.55)).add(pow(d, 6.0).mul(0.18)).mul(u.day);
    return vec3(u.sunColor).mul(disc.add(glow));
  });

  const moon = Fn(() => {
    // At night the light direction is the moon's.
    const d = max(dot(dir, sunDir), 0.0);
    const disc = smoothstep(0.99885, 0.9991, d);
    const craters = mx_noise_float(dir.mul(900.0)).mul(0.18).add(0.86);
    const halo = pow(d, 400.0).mul(0.6).add(pow(d, 30.0).mul(0.06));
    return vec3(0.75, 0.82, 1.0).mul(disc.mul(craters).mul(4.0).add(halo)).mul(u.moon);
  });

  const stars = Fn(() => {
    const s = dir.mul(260.0);
    const cell = floor(s);
    const h = hash(cell.x.add(cell.y.mul(157.0)).add(cell.z.mul(113.0)));
    const local = length(fract(s).sub(0.5));
    const point = smoothstep(0.32, 0.0, local).mul(smoothstep(0.9955, 1.0, h));
    const twinkle = sin(time.mul(h.mul(5.0).add(1.0)).add(h.mul(100.0))).mul(0.35).add(0.65);
    const aboveHorizon = smoothstep(0.02, 0.18, dir.y);
    return vec3(0.9, 0.93, 1.0).mul(point).mul(twinkle).mul(aboveHorizon).mul(u.stars).mul(3.0);
  });

  /** Thin clouds: rgb + coverage in alpha. */
  const clouds = Fn(() => {
    const h = max(dir.y, 0.0);
    const p = dir.xz.div(h.add(0.18)).mul(0.9);
    const n = mx_fractal_noise_float(vec3(p.x.add(time.mul(0.004)), p.y, time.mul(0.01)), 4, 2.0, 0.5).mul(0.5).add(0.5);
    const amount = smoothstep(0.55, 0.85, n).mul(smoothstep(0.02, 0.25, h)).mul(0.55);
    const facing = max(dot(dir, sunDir), 0.0).mul(0.5).add(0.5);
    const lit = mix(vec3(u.zenith).mul(1.6), vec3(u.sunColor).mul(mix(0.35, 1.1, u.day)), facing);
    return vec4(lit, amount);
  });

  const emissive = Fn(() => sun().add(moon()).add(stars()));

  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  material.colorNode = Fn(() => {
    const c = clouds();
    return mix(gradient(), c.xyz, c.w).add(emissive());
  })();
  const emissiveMrt = mrt({ emissive: emissive() });

  const mesh = new Mesh(new SphereGeometry(900, 48, 24), material);
  mesh.name = 'explore_sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return {
    mesh,
    uniforms: u,
    /** Route the sun/moon/stars into the emissive MRT (only when the post pipeline renders one). */
    useEmissiveMrt(on) {
      material.mrtNode = on ? emissiveMrt : null;
      material.needsUpdate = true;
    },
  };
}
