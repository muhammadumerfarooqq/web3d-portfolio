// World-space bounding boxes of every mesh node in a GLB, read from the JSON chunk only (accessor
// min/max are required by glTF even for Draco meshes; node TRS is composed with three's Object3D).
// Used by the horse-path test to check the street graph against the real building footprints.
import { readFileSync } from 'node:fs';
import { Box3, Object3D, Vector3 } from 'three';

export function glbJson(file) {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

/** { nodeName: Box3 } in world space. */
export function meshBounds(file) {
  const j = glbJson(file);
  const objs = j.nodes.map((n) => {
    const o = new Object3D();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
  const root = new Object3D();
  for (const o of objs) if (!o.parent) root.add(o);
  root.updateMatrixWorld(true);
  const out = {};
  j.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const box = new Box3();
    for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      box.union(new Box3(new Vector3(...a.min), new Vector3(...a.max)).applyMatrix4(objs[i].matrixWorld));
    }
    out[n.name] = box;
  });
  return out;
}

/** World positions of named nodes (e.g. skeleton bones) in the bind pose. */
export function nodePositions(file, names) {
  const j = glbJson(file);
  const objs = j.nodes.map((n) => {
    const o = new Object3D();
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
  const root = new Object3D();
  for (const o of objs) if (!o.parent) root.add(o);
  root.updateMatrixWorld(true);
  const out = {};
  for (const name of names) {
    const i = j.nodes.findIndex((n) => n.name === name);
    if (i >= 0) out[name] = new Vector3().setFromMatrixPosition(objs[i].matrixWorld);
  }
  return out;
}
