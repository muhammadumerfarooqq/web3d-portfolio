// Decode a named Draco mesh from a GLB in Node with the project's own self-hosted decoder
// (public/draco/draco_decoder.js, the pure-JS build), apply its node's world transform and build a
// three-mesh-bvh over it. Used to test the horse's stop points against the real island ground.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import { BufferAttribute, BufferGeometry, Object3D, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const ROOT = join(import.meta.dirname, '..', '..');
let decoderModule = null;

async function draco() {
  if (decoderModule) return decoderModule;
  const file = join(ROOT, 'public', 'draco', 'draco_decoder.js');
  // The decoder is an Emscripten UMD script; the package is "type": "module", so run it as CommonJS.
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function (module, exports, require, __filename, __dirname) {${readFileSync(file, 'utf8')}\n})`, { filename: file });
  wrapper(module, module.exports, createRequire(file), file, join(ROOT, 'public', 'draco'));
  decoderModule = await module.exports({});
  return decoderModule;
}

function readGlb(file) {
  const b = readFileSync(file);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = b.readUInt32LE(20 + jsonLen);
  return { json, bin: b.subarray(binStart, binStart + binLen) };
}

function worldMatrices(json) {
  const objs = json.nodes.map((n) => {
    const o = new Object3D();
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
  const root = new Object3D();
  for (const o of objs) if (!o.parent) root.add(o);
  root.updateMatrixWorld(true);
  return objs.map((o) => o.matrixWorld);
}

/** World-space BufferGeometry of a Draco-compressed mesh node. */
export async function decodeMeshNode(file, nodeName) {
  const d = await draco();
  const { json, bin } = readGlb(file);
  const index = json.nodes.findIndex((n) => n.name === nodeName);
  if (index < 0) throw new Error(`no node ${nodeName}`);
  const matrix = worldMatrices(json)[index];
  const positions = [];
  const indices = [];
  for (const prim of json.meshes[json.nodes[index].mesh].primitives) {
    const ext = prim.extensions?.KHR_draco_mesh_compression;
    if (!ext) throw new Error('expected a Draco primitive');
    const view = json.bufferViews[ext.bufferView];
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const decoder = new d.Decoder();
    const buffer = new d.DecoderBuffer();
    buffer.Init(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength);
    const mesh = new d.Mesh();
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok()) throw new Error(`draco: ${status.error_msg()}`);
    const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
    const values = new d.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attr, values);
    const base = positions.length / 3;
    const v = new Vector3();
    for (let i = 0; i < mesh.num_points(); i += 1) {
      v.set(values.GetValue(i * 3), values.GetValue(i * 3 + 1), values.GetValue(i * 3 + 2)).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
    }
    const face = new d.DracoInt32Array();
    for (let f = 0; f < mesh.num_faces(); f += 1) {
      decoder.GetFaceFromMesh(mesh, f, face);
      indices.push(base + face.GetValue(0), base + face.GetValue(1), base + face.GetValue(2));
    }
    for (const o of [face, values, mesh, buffer, decoder]) d.destroy(o);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Ground height sampler from the real terrain: a BVH ray straight down (null off the island). */
export async function groundSampler(file, nodeName = 'ground') {
  const geometry = await decodeMeshNode(file, nodeName);
  const bvh = new MeshBVH(geometry);
  const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
  return (x, z) => {
    ray.origin.set(x, 60, z);
    const hit = bvh.raycastFirst(ray, 2);
    return hit ? hit.point.y : null;
  };
}
