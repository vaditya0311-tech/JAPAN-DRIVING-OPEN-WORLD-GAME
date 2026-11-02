/* Build a shim-THREE scene graph from a .glb, mirroring what GLTFLoader produces for this asset. */
'use strict';
const fs = require('fs');
function parseGLB(path) {
  const d = fs.readFileSync(path); let off = 12, json = null, bin = null;
  while (off < d.length) {
    const len = d.readUInt32LE(off), type = d.readUInt32LE(off + 4), body = d.subarray(off + 8, off + 8 + len); off += 8 + len;
    if (type === 0x4E4F534A) json = JSON.parse(body.toString('utf8')); else if (type === 0x004E4942) bin = body;
  }
  return { json, bin };
}
function accessor(json, bin, i) {
  const a = json.accessors[i], bv = json.bufferViews[a.bufferView];
  const ctor = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array }[a.componentType];
  const nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const start = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  if (bv.byteStride && bv.byteStride !== nc * ctor.BYTES_PER_ELEMENT) throw new Error('interleaved accessor not supported');
  return new ctor(bin.buffer.slice(start, start + a.count * nc * ctor.BYTES_PER_ELEMENT));
}
function buildScene(THREE, path) {
  const { json, bin } = parseGLB(path);
  const mats = (json.materials || []).map(m => ({ name: m.name, type: 'MeshStandardMaterial', emissiveIntensity: 1 }));
  const objs = json.nodes.map(n => {
    let o;
    if (n.mesh !== undefined) {
      const prim = json.meshes[n.mesh].primitives; if (prim.length !== 1) throw new Error('multi-primitive mesh not expected');
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(accessor(json, bin, prim[0].attributes.POSITION), 3));
      if (prim[0].attributes.NORMAL !== undefined) g.setAttribute('normal', new THREE.BufferAttribute(accessor(json, bin, prim[0].attributes.NORMAL), 3));
      g.setIndex(new THREE.BufferAttribute(accessor(json, bin, prim[0].indices), 1));
      o = new THREE.Mesh(g, mats[prim[0].material]);
    } else o = new THREE.Group();
    o.name = (n.name || '').replace(/[\[\]\.:\/]/g, '');
    if (n.matrix) o.matrix.fromArray(n.matrix);
    else {
      const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      o.matrix.compose(new THREE.Vector3().fromArray(t), new THREE.Quaternion(r[0], r[1], r[2], r[3]), new THREE.Vector3().fromArray(s));
    }
    o.matrix.decompose(o.position, o.quaternion, o.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach(c => objs[i].add(objs[c])));
  const scene = new THREE.Group(); scene.name = 'Scene';
  json.scenes[json.scene || 0].nodes.forEach(i => scene.add(objs[i]));
  return { scene, json };
}
module.exports = { buildScene };
