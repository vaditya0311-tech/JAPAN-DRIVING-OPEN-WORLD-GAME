#!/usr/bin/env node
'use strict';
// Execute the real architecture-mesh helper with a tiny Three-like geometry stub.
// This validates the generated positions/UVs/colors without needing WebGL or a CDN.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

class Color {
  constructor(hex = 0xffffff) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
  }
  clone() { const c = new Color(); c.r = this.r; c.g = this.g; c.b = this.b; return c; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
}
class Attribute {
  constructor(array, itemSize) { this.array = Float32Array.from(array); this.itemSize = itemSize; this.count = this.array.length / itemSize; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.normalsComputed = false; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  computeVertexNormals() { this.normalsComputed = true; return this; }
}
const THREE = { Color, BufferGeometry, Float32BufferAttribute: Attribute };
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const start = source.indexOf('function chamferedFootprint(');
const end = source.indexOf('function addFacadeInstances(', start);
if (start < 0 || end < 0) throw new Error('Could not locate actual architecture helper in index.html');
const helpers = source.slice(start, end);
const code = `${helpers}
const fp=chamferedFootprint(20,18,1,1);
const city=mergeArchitecturalMasses([{x:0,y:40,z:0,w:24,h:80,d:22,arch:'setback_tower',c:new THREE.Color(0x8ca1ad)}]);
const village=mergeArchitecturalMasses([{x:30,y:2,z:30,w:9,h:4,d:8,arch:'village_house',c:new THREE.Color(0xd5c6a8)}]);
({ footprint:fp, city:city.attributes, village:village.attributes, cityNormals:city.normalsComputed, villageNormals:village.normalsComputed });`;
const result = vm.runInNewContext(code, { THREE });
function assert(condition, message) { if (!condition) throw new Error(message); }
assert(result.footprint.length === 8, 'footprint should contain 8 beveled corners');
for (const [label, shape] of [['city', result.city], ['village', result.village]]) {
  assert(shape.position && shape.position.count >= 100, `${label}: too few generated vertices`);
  assert(shape.uv && shape.uv.count === shape.position.count, `${label}: UV stream mismatch`);
  assert(shape.color && shape.color.count === shape.position.count, `${label}: vertex color stream mismatch`);
  for (const [name, attr] of Object.entries(shape)) {
    if (attr && attr.array) for (const n of attr.array) assert(Number.isFinite(n), `${label}: non-finite ${name} data`);
  }
}
assert(result.cityNormals && result.villageNormals, 'normal generation was not requested');
console.log('PASS: beveled footprint and finite city/village meshes');
console.log(`PASS: city vertices=${result.city.position.count}; village vertices=${result.village.position.count}; UV/color attributes aligned`);
