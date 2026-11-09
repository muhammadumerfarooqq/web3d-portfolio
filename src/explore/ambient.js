// Ambient motion: bunting and flags sway in the wind (vertex shader), hanging signs swing a little,
// and a tumbleweed rolls across the street now and then.
import { Box3, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardNodeMaterial, Quaternion, Vector3 } from 'three/webgpu';
import { clamp, color, float, positionLocal, sin, time, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A tumbleweed: a ball of thin twigs (one merged geometry). */
function tumbleweedGeometry() {
  const parts = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const axis = new Vector3();
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 46; i += 1) {
    const g = new CylinderGeometry(0.012, 0.009, 0.55 + rand() * 0.35, 3, 1);
    axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    q.setFromAxisAngle(axis, rand() * Math.PI);
    m.compose(new Vector3((rand() - 0.5) * 0.35, (rand() - 0.5) * 0.35, (rand() - 0.5) * 0.35), q, new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export function createAmbient({ scene, flags, signs, wallBoxes, heightAt, bvhRaycastDown }) {
  const wind = uniform(1);
  const disposables = [];

  // Flags / bunting: displace along local Z, more where the cloth hangs lower.
  const flagMats = new Set();
  for (const f of flags) {
    if (flagMats.has(f.material)) continue;
    const mat = f.material.clone();
    f.geometry.computeBoundingBox();
    const b = f.geometry.boundingBox;
    const top = b.max.y;
    const h = Math.max(0.01, b.max.y - b.min.y);
    const hang = clamp(float(top).sub(positionLocal.y).div(h), 0, 1);
    const wave = sin(time.mul(3.1).add(positionLocal.x.mul(2.3))).mul(0.7).add(sin(time.mul(5.3).add(positionLocal.x.mul(4.1))).mul(0.3));
    mat.positionNode = positionLocal.add(vec3(0, 0, wave.mul(hang).mul(0.09).mul(wind)));
    for (const other of flags) if (other.material === f.material) other.material = mat;
    flagMats.add(mat);
    disposables.push(mat);
  }

  // Signs that hang (clear gap to their building's wall bounds) swing ±2.5° about their top edge.
  const swinging = [];
  for (const s of signs) {
    const box = new Box3().setFromObject(s);
    const wb = wallBoxes.get(s.name.replace(/_sign$/, '_walls'));
    if (wb) {
      const gap = Math.max(wb.min.x - box.max.x, box.min.x - wb.max.x, wb.min.z - box.max.z, box.min.z - wb.max.z);
      if (gap < 0.25) continue;
    }
    const pivot = new Group();
    pivot.position.set((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    s.parent.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(s);
    swinging.push({ pivot, phase: Math.random() * 6 });
  }

  // Tumbleweed.
  const twMat = new MeshStandardNodeMaterial({ roughness: 1 });
  twMat.colorNode = color(0.32, 0.2, 0.09);
  const tumble = new Mesh(tumbleweedGeometry(), twMat);
  tumble.castShadow = true;
  tumble.name = 'explore_tumbleweed';
  scene.add(tumble);
  disposables.push(tumble.geometry, twMat);
  const tw = { x: -40, z: 0, wait: 3 + Math.random() * 5, speed: 3.6 };

  return {
    wind,
    update(dt, elapsed) {
      for (const { pivot, phase } of swinging) pivot.rotation.x = Math.sin(elapsed * 1.7 + phase) * 0.045 * wind.value;
      if (tw.wait > 0) {
        tw.wait -= dt;
        tumble.visible = false;
        if (tw.wait <= 0) {
          tw.x = -26;
          tw.z = -30 + Math.random() * 48;
          tw.speed = 3 + Math.random() * 1.8;
        }
        return;
      }
      tumble.visible = true;
      tw.x += tw.speed * dt;
      tw.z += Math.sin(elapsed * 0.7) * 0.4 * dt;
      const ground = heightAt(tw.x, tw.z) ?? 0;
      const floor = bvhRaycastDown(tw.x, tw.z) ?? ground;
      const bounce = Math.abs(Math.sin(elapsed * 3.2)) * 0.32;
      tumble.position.set(tw.x, floor + 0.36 + bounce, tw.z);
      tumble.rotation.z -= (tw.speed * dt) / 0.36;
      tumble.rotation.x += dt * 0.4;
      if (tw.x > 26) tw.wait = 8 + Math.random() * 10;
    },
    dispose() {
      tumble.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
