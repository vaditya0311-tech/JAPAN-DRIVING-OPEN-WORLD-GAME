/* Offline test: runs the REAL supra_rig.js against the REAL Supra GLB geometry using the shim.
   Usage: node tools/test_supra_rig.js [path/to/toyota_supra.glb]  (exit code 1 on any FAIL) */
'use strict';
const path = require('path');
const THREE = require('./three_shim.js');
const { buildScene } = require('./glb_to_scene.js');
const SupraRig = require('../supra_rig.js');
const glb = process.argv[2] || path.join(__dirname, '..', 'assets', 'vehicles', 'toyota_supra.glb');

let t = Date.now();
const { scene } = buildScene(THREE, glb);
console.log(`GLB parsed -> scene graph in ${Date.now() - t} ms`);

// Same normalisation as index.html's adapter
scene.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
const scale = 4.370 / size.z;
const wrapper = new THREE.Group(); wrapper.name = 'ToyotaSupra_ModelAdapter';
scene.scale.set(scale, scale, scale);
scene.position.set(-ctr.x * scale, -box.min.y * scale, -ctr.z * scale);
wrapper.add(scene); wrapper.updateMatrixWorld(true);
console.log(`source bounds W ${size.x.toFixed(4)} H ${size.y.toFixed(4)} L ${size.z.toFixed(4)}  uniform scale ${scale.toFixed(5)}`);

t = Date.now();
const rig = SupraRig.build(THREE, wrapper);
console.log(`rig.build: ok=${rig.ok} in ${Date.now() - t} ms  errors=${JSON.stringify(rig.errors)}`);
if (rig.ok) {
  rig.wheels.forEach(w => console.log(`  ${w.name}: hub (${w.hub.x.toFixed(3)}, ${w.hub.y.toFixed(3)}, ${w.hub.z.toFixed(3)}) r=${w.radius.toFixed(4)} w=${w.width.toFixed(3)} node=${w.node.name} children=${w.node.children.length}`));
  rig.calipers.forEach(c => console.log(`  caliper -> ${c.wheel}: ${c.node.name} (dist to hub ${c.dist.toFixed(3)})`));
  if (rig.sw) rig.sw.sourceMeshes.forEach(s => console.log(`  steering-wheel part: ${s.material.padEnd(16)} ${s.triangles}/${s.of} tris`));
}

t = Date.now();
const res = SupraRig.selfTest(THREE, rig, { raycast: true });
console.log(`selfTest in ${Date.now() - t} ms\n`);
let fails = 0;
res.forEach(r => { if (r.status === 'FAIL') fails++; console.log(`${r.status.padEnd(4)} ${r.id.padEnd(4)} ${r.name}\n          ${r.detail}`); });
console.log(`\n${res.filter(r => r.status === 'PASS').length} PASS, ${fails} FAIL, ${res.filter(r => r.status === 'SKIP' || r.status === 'INFO').length} other`);
process.exit(fails ? 1 : 0);
