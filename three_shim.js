/* Minimal Three.js-compatible subset for OFFLINE testing of supra_rig.js in Node.
   Implements only what the rig/self-test use, with the same maths and conventions as Three.js r128
   (column-major Matrix4, Euler orders, Object3D.attach, Box3.setFromObject as AABB of the transformed
   geometry box, two-sided Möller–Trumbore raycasting). It is NOT a renderer. */
'use strict';

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; return this.set(x, y, z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyMatrix4(m) {
    const e = m.elements, x = this.x, y = this.y, z = this.z, w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w; return this;
  }
  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx; return this;
  }
  setFromMatrixPosition(m) { const e = m.elements; this.x = e[12]; this.y = e[13]; this.z = e[14]; return this; }
  setFromMatrixColumn(m, i) { const e = m.elements, o = i * 4; this.x = e[o]; this.y = e[o + 1]; this.z = e[o + 2]; return this; }
}

class Matrix4 {
  constructor() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  identity() { this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; return this; }
  copy(m) { this.elements = m.elements.slice(); return this; }
  clone() { return new Matrix4().copy(this); }
  fromArray(a, o = 0) { for (let i = 0; i < 16; i++) this.elements[i] = a[o + i]; return this; }
  multiplyMatrices(a, b) {
    const ae = a.elements, be = b.elements, te = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += ae[k * 4 + r] * be[c * 4 + k]; te[c * 4 + r] = s;
    }
    this.elements = te; return this;
  }
  multiply(m) { return this.multiplyMatrices(this, m); }
  premultiply(m) { return this.multiplyMatrices(m, this); }
  compose(p, q, s) {
    const x = q.x, y = q.y, z = q.z, w = q.w, x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    const te = this.elements;
    te[0] = (1 - (yy + zz)) * s.x; te[1] = (xy + wz) * s.x; te[2] = (xz - wy) * s.x; te[3] = 0;
    te[4] = (xy - wz) * s.y; te[5] = (1 - (xx + zz)) * s.y; te[6] = (yz + wx) * s.y; te[7] = 0;
    te[8] = (xz + wy) * s.z; te[9] = (yz - wx) * s.z; te[10] = (1 - (xx + yy)) * s.z; te[11] = 0;
    te[12] = p.x; te[13] = p.y; te[14] = p.z; te[15] = 1; return this;
  }
  decompose(p, q, s) {
    const te = this.elements;
    let sx = Math.hypot(te[0], te[1], te[2]); const sy = Math.hypot(te[4], te[5], te[6]), sz = Math.hypot(te[8], te[9], te[10]);
    const det = this.determinant(); if (det < 0) sx = -sx;
    p.x = te[12]; p.y = te[13]; p.z = te[14];
    const m = this.clone(), e = m.elements, isx = 1 / sx, isy = 1 / sy, isz = 1 / sz;
    e[0] *= isx; e[1] *= isx; e[2] *= isx; e[4] *= isy; e[5] *= isy; e[6] *= isy; e[8] *= isz; e[9] *= isz; e[10] *= isz;
    q.setFromRotationMatrix(m); s.x = sx; s.y = sy; s.z = sz; return this;
  }
  determinant() {
    const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7],
      n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
  }
  invert() {
    const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7],
      n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];
    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44,
      t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44,
      t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44,
      t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) return this.identity();
    const d = 1 / det;
    te[0] = t11 * d; te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
    te[4] = t12 * d; te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
    te[8] = t13 * d; te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
    te[12] = t14 * d; te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
    return this;
  }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; this._cb = null; }
  _changed() { if (this._cb) this._cb(); }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; this._changed(); return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; this._changed(); return this; }
  clone() { return new Quaternion(this.x, this.y, this.z, this.w); }
  setFromAxisAngle(axis, angle) { const h = angle / 2, s = Math.sin(h); return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h)); }
  setFromEuler(e, update = true) {
    const x = e.x, y = e.y, z = e.z, c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    switch (e.order) {
      case 'XYZ': this.x = s1 * c2 * c3 + c1 * s2 * s3; this.y = c1 * s2 * c3 - s1 * c2 * s3; this.z = c1 * c2 * s3 + s1 * s2 * c3; this.w = c1 * c2 * c3 - s1 * s2 * s3; break;
      case 'YXZ': this.x = s1 * c2 * c3 + c1 * s2 * s3; this.y = c1 * s2 * c3 - s1 * c2 * s3; this.z = c1 * c2 * s3 - s1 * s2 * c3; this.w = c1 * c2 * c3 + s1 * s2 * s3; break;
      default: throw new Error('euler order not in shim: ' + e.order);
    }
    if (update) this._changed(); return this;
  }
  setFromRotationMatrix(m) {
    const te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10], tr = m11 + m22 + m33;
    let s;
    if (tr > 0) { s = 0.5 / Math.sqrt(tr + 1); this.w = 0.25 / s; this.x = (m32 - m23) * s; this.y = (m13 - m31) * s; this.z = (m21 - m12) * s; }
    else if (m11 > m22 && m11 > m33) { s = 2 * Math.sqrt(1 + m11 - m22 - m33); this.w = (m32 - m23) / s; this.x = 0.25 * s; this.y = (m12 + m21) / s; this.z = (m13 + m31) / s; }
    else if (m22 > m33) { s = 2 * Math.sqrt(1 + m22 - m11 - m33); this.w = (m13 - m31) / s; this.x = (m12 + m21) / s; this.y = 0.25 * s; this.z = (m23 + m32) / s; }
    else { s = 2 * Math.sqrt(1 + m33 - m11 - m22); this.w = (m21 - m12) / s; this.x = (m13 + m31) / s; this.y = (m23 + m32) / s; this.z = 0.25 * s; }
    this._changed(); return this;
  }
  multiply(q) { return this.multiplyQuaternions(this, q); }
  multiplyQuaternions(a, b) {
    const qax = a.x, qay = a.y, qaz = a.z, qaw = a.w, qbx = b.x, qby = b.y, qbz = b.z, qbw = b.w;
    this.x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby; this.y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this.z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx; this.w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._changed(); return this;
  }
}

class Euler {
  constructor(x = 0, y = 0, z = 0, order = 'XYZ') { this.x = x; this.y = y; this.z = z; this.order = order; this._cb = null; }
  set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; if (this._cb) this._cb(); return this; }
  setFromQuaternion(q) {
    // Rebuild via rotation matrix, order-aware for the orders used here
    const m = new Matrix4().compose(new Vector3(), q, new Vector3(1, 1, 1)), te = m.elements;
    const m11 = te[0], m12 = te[4], m13 = te[8], m22 = te[5], m23 = te[9], m32 = te[6], m33 = te[10], cl = v => Math.max(-1, Math.min(1, v));
    if (this.order === 'YXZ') {
      this.x = Math.asin(-cl(m23));
      if (Math.abs(m23) < 0.9999999) { this.y = Math.atan2(m13, m33); this.z = Math.atan2(m11 * 0 + te[1], m22); } else { this.y = Math.atan2(-te[2], m11); this.z = 0; }
    } else { // XYZ
      this.y = Math.asin(cl(m13));
      if (Math.abs(m13) < 0.9999999) { this.x = Math.atan2(-m23, m33); this.z = Math.atan2(-m12, m11); } else { this.x = Math.atan2(m32, m22); this.z = 0; }
    }
    return this;
  }
}

let _id = 1;
class Object3D {
  constructor() {
    this.id = _id++; this.name = ''; this.parent = null; this.children = []; this.isObject3D = true;
    this.position = new Vector3(); this.quaternion = new Quaternion(); this.rotation = new Euler(); this.scale = new Vector3(1, 1, 1);
    this.matrix = new Matrix4(); this.matrixWorld = new Matrix4(); this.visible = true; this.userData = {};
    this.rotation._cb = () => { this.quaternion.setFromEuler(this.rotation, false); };
    this.quaternion._cb = () => { this.rotation.x = this.rotation.x; /* euler is derived on demand */ this._eulerStale = true; };
  }
  add(o) { for (let i = 0; i < arguments.length; i++) { const c = arguments[i]; if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) { this.children.splice(i, 1); o.parent = null; } return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  updateMatrix() { this.matrix.compose(this.position, this.quaternion, this.scale); }
  updateMatrixWorld(force) {
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); else this.matrixWorld.copy(this.matrix);
    for (const c of this.children) c.updateMatrixWorld(force);
  }
  updateWorldMatrix(up, down) {
    if (up && this.parent) this.parent.updateWorldMatrix(true, false);
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); else this.matrixWorld.copy(this.matrix);
    if (down) for (const c of this.children) c.updateWorldMatrix(false, true);
  }
  applyMatrix4(m) { this.updateMatrix(); this.matrix.premultiply(m); this.matrix.decompose(this.position, this.quaternion, this.scale); }
  attach(object) {
    this.updateWorldMatrix(true, false);
    const m1 = new Matrix4().copy(this.matrixWorld).invert();
    if (object.parent) { object.parent.updateWorldMatrix(true, false); m1.multiply(object.parent.matrixWorld); }
    object.applyMatrix4(m1);
    object.updateWorldMatrix(false, false);
    this.add(object); return this;
  }
  getWorldPosition(t) { this.updateWorldMatrix(true, false); return t.setFromMatrixPosition(this.matrixWorld); }
  getWorldQuaternion(t) {
    this.updateWorldMatrix(true, false); const p = new Vector3(), s = new Vector3();
    this.matrixWorld.decompose(p, t, s); return t;
  }
}
class Group extends Object3D { constructor() { super(); this.isGroup = true; } }

class BufferAttribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } getZ(i) { return this.array[i * this.itemSize + 2]; }
}
class Box3 {
  constructor() { this.min = new Vector3(Infinity, Infinity, Infinity); this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
  makeEmpty() { this.min.set(Infinity, Infinity, Infinity); this.max.set(-Infinity, -Infinity, -Infinity); return this; }
  clone() { const b = new Box3(); b.min.copy(this.min); b.max.copy(this.max); return b; }
  isEmpty() { return this.max.x < this.min.x; }
  expandByPoint(p) { this.min.x = Math.min(this.min.x, p.x); this.min.y = Math.min(this.min.y, p.y); this.min.z = Math.min(this.min.z, p.z); this.max.x = Math.max(this.max.x, p.x); this.max.y = Math.max(this.max.y, p.y); this.max.z = Math.max(this.max.z, p.z); return this; }
  union(b) { this.expandByPoint(b.min); this.expandByPoint(b.max); return this; }
  applyMatrix4(m) {
    if (this.isEmpty()) return this; const mn = this.min, mx = this.max, pts = [];
    for (const x of [mn.x, mx.x]) for (const y of [mn.y, mx.y]) for (const z of [mn.z, mx.z]) pts.push(new Vector3(x, y, z).applyMatrix4(m));
    this.makeEmpty(); pts.forEach(p => this.expandByPoint(p)); return this;
  }
  expandByObject(o) {
    o.updateWorldMatrix(false, false);
    if (o.isMesh && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); this.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    for (const c of o.children) this.expandByObject(c); return this;
  }
  setFromObject(o) { this.makeEmpty(); return this.expandByObject(o); }
  getSize(t) { return t.set(this.max.x - this.min.x, this.max.y - this.min.y, this.max.z - this.min.z); }
  getCenter(t) { return t.set((this.max.x + this.min.x) / 2, (this.max.y + this.min.y) / 2, (this.max.z + this.min.z) / 2); }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.index = null; this.boundingBox = null; this.boundingSphere = null; }
  setAttribute(n, a) { this.attributes[n] = a; return this; } getAttribute(n) { return this.attributes[n]; }
  setIndex(a) { this.index = a; return this; } getIndex() { return this.index; }
  computeBoundingBox() {
    const p = this.attributes.position.array, b = new Box3(); const v = new Vector3();
    for (let i = 0; i < p.length; i += 3) b.expandByPoint(v.set(p[i], p[i + 1], p[i + 2]));
    this.boundingBox = b;
  }
}
class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.isMesh = true; this.geometry = geometry; this.material = material; this.castShadow = false; this.receiveShadow = false; }
}
class Raycaster {
  constructor() { this.origin = new Vector3(); this.direction = new Vector3(0, 0, -1); this.far = Infinity; this.near = 0; }
  set(o, d) { this.origin.copy(o); this.direction.copy(d); return this; }
  intersectObject(obj, recursive) {
    const hits = [];
    const visit = o => {
      if (o.isMesh) this._mesh(o, hits);
      if (recursive) o.children.forEach(visit);
    };
    obj.updateMatrixWorld(true); visit(obj);
    hits.sort((a, b) => a.distance - b.distance); return hits;
  }
  _mesh(mesh, hits) {
    const g = mesh.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const inv = new Matrix4().copy(mesh.matrixWorld).invert();
    const o = this.origin.clone().applyMatrix4(inv);
    const d = this.direction.clone().applyMatrix4(inv).sub(new Vector3().applyMatrix4(inv)); // direction in local (not normalised)
    // slab test on the local AABB
    let tmin = -Infinity, tmax = Infinity;
    for (const ax of ['x', 'y', 'z']) {
      const lo = g.boundingBox.min[ax], hi = g.boundingBox.max[ax];
      if (Math.abs(d[ax]) < 1e-15) { if (o[ax] < lo || o[ax] > hi) return; continue; }
      let t1 = (lo - o[ax]) / d[ax], t2 = (hi - o[ax]) / d[ax]; if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return;
    }
    const P = g.attributes.position.array, I = g.index.array;
    let best = Infinity, bi = -1;
    const ox = o.x, oy = o.y, oz = o.z, dx = d.x, dy = d.y, dz = d.z;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-18) continue;
      const inv_ = 1 / det, tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv_; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv_; if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv_; if (tt > 1e-9 && tt < best) { best = tt; bi = t; }
    }
    if (bi < 0) return;
    const pt = new Vector3(ox + dx * best, oy + dy * best, oz + dz * best).applyMatrix4(mesh.matrixWorld);
    const dist = pt.distanceTo(this.origin); if (dist > this.far || dist < this.near) return;
    hits.push({ distance: dist, point: pt, object: mesh });
  }
}

module.exports = { Vector3, Matrix4, Quaternion, Euler, Object3D, Group, Mesh, Box3, BufferGeometry, BufferAttribute, Raycaster };
