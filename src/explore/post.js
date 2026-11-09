// Post-processing (three/webgpu RenderPipeline + TSL display nodes), built per tier:
//   scene pass (MRT: colour, emissive, normal, metal/rough as needed)
//   → GTAO → SSR (wet street) → god rays → depth of field on the player
//   → selective bloom (emissive MRT; "cheap" luminance bloom on LOW) + lens flare by day
//   → tone mapping (renderOutput) → procedural 3D LUT grade (golden hour ↔ teal-orange night)
//   → chromatic aberration (grows with speed) → glitch + pixelation dissolve (events only)
//   → SMAA → vignette + fine grain.
import { ClampToEdgeWrapping, Data3DTexture, LinearFilter, RGBAFormat, RenderPipeline, UnsignedByteType, Color } from 'three/webgpu';
import {
  Fn,
  convertToTexture,
  dot,
  emissive,
  float,
  floor,
  hash,
  length,
  metalness,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  roughness,
  sample,
  screenSize,
  screenUV,
  smoothstep,
  step,
  texture3D,
  unpackRGBToNormal,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { GRADES } from './grades.js';

const LUT_SIZE = 32;
export function makeLut(grade, size = LUT_SIZE) {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const [R, G, B] = grade([r / (size - 1), g / (size - 1), b / (size - 1)]);
        data[i++] = Math.round(R * 255);
        data[i++] = Math.round(G * 255);
        data[i++] = Math.round(B * 255);
        data[i++] = 255;
      }
    }
  }
  const tex = new Data3DTexture(data, size, size, size);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export function createPost({ renderer, scene, camera, settings, sun, sky, particles, reducedMotion }) {
  const u = {
    bloom: uniform(0.8),
    ao: uniform(0.8),
    ssr: uniform(0.6),
    focus: uniform(6),
    focal: uniform(5),
    bokeh: uniform(0.8),
    grade: uniform(1),
    lut: uniform(1),
    ca: uniform(0),
    glitch: uniform(0),
    fade: uniform(0), // raised only for the entry dissolve
    flare: uniform(0),
    godrays: uniform(0),
    sunColor: uniform(new Color(1, 0.6, 0.3)),
    vignette: uniform(0.32),
    grain: uniform(0.028),
  };
  const enabled = [];
  const disposables = [];

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;

  const scenePass = pass(scene, camera);
  const fullBloom = settings.bloom === 'full';
  const needNormal = settings.ao || settings.ssr;
  const outputs = { output };
  if (fullBloom) outputs.emissive = emissive;
  if (needNormal) outputs.normal = packNormalToRGB(normalView);
  if (settings.ssr) outputs.metalrough = vec2(metalness, roughness);
  if (Object.keys(outputs).length > 1) scenePass.setMRT(mrt(outputs));
  sky.useEmissiveMrt(fullBloom);
  particles.setEmissiveMrt(fullBloom);

  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  let lit = color;

  let sceneNormal = null;
  if (needNormal) {
    const normalTex = scenePass.getTextureNode('normal');
    sceneNormal = sample((uv) => unpackRGBToNormal(normalTex.sample(uv)));
  }

  if (settings.ao) {
    const aoPass = ao(depth, sceneNormal, camera);
    aoPass.resolutionScale = 0.5;
    disposables.push(aoPass);
    const occlusion = aoPass.getTextureNode().sample(screenUV).r;
    lit = lit.mul(mix(float(1), occlusion, u.ao));
    enabled.push('GTAO');
  }

  if (settings.ssr) {
    const mr = scenePass.getTextureNode('metalrough');
    const ssrPass = ssr(color, depth, sceneNormal, { metalnessNode: mr.r, roughnessNode: mr.g, reflectNonMetals: true, camera });
    ssrPass.resolutionScale = 0.5;
    disposables.push(ssrPass);
    const refl = ssrPass.getTextureNode();
    lit = lit.add(refl.rgb.mul(refl.a).mul(u.ssr));
    enabled.push('SSR');
  }

  if (settings.godrays && sun.castShadow) {
    const gr = godrays(depth, camera, sun);
    disposables.push(gr);
    // depthAwareBlend samples both inputs, so they must be textures
    lit = depthAwareBlend(convertToTexture(lit), gr.getTextureNode(), depth, camera, { blendColor: vec3(u.sunColor).mul(u.godrays), edgeRadius: 2, edgeStrength: 2 });
    enabled.push('god rays');
  }

  if (settings.dof) {
    const dofPass = dof(lit, scenePass.getViewZNode(), u.focus, u.focal, u.bokeh);
    disposables.push(dofPass);
    lit = dofPass;
    enabled.push('DOF');
  }

  const bloomPass = fullBloom ? bloom(scenePass.getTextureNode('emissive'), 1, 0.55, 0) : bloom(color, 1, 0.35, 0.82);
  bloomPass.strength = u.bloom;
  disposables.push(bloomPass);
  enabled.push(fullBloom ? 'selective bloom' : 'cheap bloom');
  let hdr = lit.add(bloomPass);

  if (settings.lensflare) {
    const flare = lensflare(bloomPass.getTextureNode(), { threshold: float(0.6), ghostAttenuationFactor: float(20), ghostSpacing: float(0.22) });
    disposables.push(flare);
    hdr = hdr.add(flare.mul(u.flare));
    enabled.push('lens flare');
  }

  let display = renderOutput(hdr);

  if (settings.lut) {
    const day = makeLut(GRADES.day);
    const night = makeLut(GRADES.night);
    disposables.push(day, night);
    const graded = mix(lut3D(display, texture3D(day), LUT_SIZE, float(1)), lut3D(display, texture3D(night), LUT_SIZE, float(1)), u.grade);
    display = mix(display, graded, u.lut);
    enabled.push('3D LUT');
  }

  if (settings.ca) {
    display = chromaticAberration(display, u.ca, vec2(0.5, 0.5), float(1.1));
    enabled.push('chromatic aberration');
  }

  // Glitch + pixelation dissolve: a single short, low-contrast event (never a strobe). Under reduced
  // motion only the fade runs.
  const displayTex = convertToTexture(display);
  const glitched = Fn(() => {
    const g = reducedMotion ? float(0) : u.glitch;
    const px = mix(float(1), float(18), g.mul(g));
    const cell = vec2(px, px).div(screenSize);
    const q = floor(screenUV.div(cell)).add(0.5).mul(cell);
    const uvq = mix(screenUV, q, step(0.02, g));
    const band = step(0.86, hash(floor(screenUV.y.mul(28)).add(floor(time.mul(7))))).mul(g).mul(0.012);
    const shifted = uvq.add(vec2(band, 0));
    const c = displayTex.sample(shifted).rgb;
    const split = displayTex.sample(shifted.add(vec2(g.mul(0.003), 0))).r;
    const mixed = vec3(mix(c.r, split, g.mul(0.5)), c.g, c.b);
    return vec4(mix(mixed, vec3(0.08, 0.063, 0.047), u.fade), 1);
  })();

  let final = glitched;
  if (settings.smaa) {
    final = smaa(final);
    enabled.push('SMAA');
  }

  const finished = Fn(() => {
    const c = final.rgb;
    const d = length(screenUV.sub(0.5));
    const vig = mix(float(1), smoothstep(0.85, 0.25, d), u.vignette);
    const pixel = floor(screenUV.mul(screenSize));
    const n = hash(pixel.x.add(pixel.y.mul(1931.0)).add(floor(time.mul(24)).mul(7919.0))).sub(0.5);
    const grain = settings.grain ? n.mul(u.grain) : float(0);
    // grain is zero-mean and weaker in the highlights, so it never reads as flicker
    return vec4(c.mul(vig).add(grain.mul(float(1).sub(dot(c, vec3(0.3, 0.59, 0.11))).mul(0.8).add(0.2))), 1);
  })();
  if (settings.grain) enabled.push('film grain');
  enabled.push('vignette', 'tone mapping', 'height fog');

  pipeline.outputNode = finished;

  return {
    uniforms: u,
    enabled,
    render: () => pipeline.render(),
    dispose() {
      for (const d of disposables) d.dispose?.();
      pipeline.dispose();
    },
  };
}

