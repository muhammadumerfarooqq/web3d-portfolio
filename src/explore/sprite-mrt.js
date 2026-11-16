// MRT for transparent effects (particles, light pools, splashes, wakes, fireworks, train smoke).
// three's WebGPU renderer writes every MRT target except `output` with NO blending, so a transparent
// sprite used to stamp its whole square quad into the normal, emissive and metal/rough targets:
// GTAO and SSR then drew dark or glowing squares around every particle (P3.4 real-GPU report). This
// MRT blends each target with the material's own blending and an explicit alpha: the emissive target
// gets the effect's glow masked by its soft round alpha, normal and metal/rough get alpha 0 (left
// untouched). Only set it when the scene pass has an MRT (otherwise three would use it alone).
import { BlendMode, MaterialBlending } from 'three/webgpu';
import { mrt, vec3, vec4 } from 'three/tsl';

const MATERIAL = new BlendMode(MaterialBlending);
export const QUIET_TARGETS = ['emissive', 'normal', 'metalrough'];

/** mask: the effect's alpha (round, soft); emissive: its glow colour for selective bloom, or null. */
export function quietMrt(mask, emissive = null) {
  const node = mrt({ emissive: vec4(emissive ?? vec3(0), mask), normal: vec4(0, 0, 0, 0), metalrough: vec4(0, 0, 0, 0) });
  for (const name of QUIET_TARGETS) node.setBlendMode(name, MATERIAL);
  return node;
}

/** Attach (on = the scene pass has an MRT) or remove the quiet MRT on a material. */
export function setQuietMrt(material, on, mask, emissive = null) {
  material.mrtNode = on ? quietMrt(mask, emissive) : null;
  material.needsUpdate = true;
}
