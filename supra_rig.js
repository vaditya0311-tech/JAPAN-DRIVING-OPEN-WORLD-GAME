/* ============================================================================
   supra_rig.js — Toyota Supra GLB rig: wheels, steering, steering wheel,
   cabin/hood camera anchors and runtime self-tests.

   Plain classic script (no build step). Works in the browser (window.SupraRig)
   and in Node (module.exports) so the same code can be tested offline against
   the real GLB geometry (see tools/test_supra_rig.js).

   THREE is always passed in, never read from a global, so tests can supply a
   minimal scene-graph implementation.

   COORDINATE CONVENTION ("car frame", verified against the GLB, see docs/SUPRA_RIG_SPEC.md)
     +Z = forward      +Y = up      +X = the car's LEFT (so the driver sits at +X: LHD)
     Origin: X/Z centre of the body bounds, Y = 0 on the ground.
     Positive heading h rotates +Z toward +X, i.e. turns the car LEFT.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SupraRig = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------------
     Measured constants. Produced by tools/inspect_glb.py from the supplied
     toyota_supra.glb (after the game's uniform 1.00011 scale and centring).
     The rig does NOT trust these blindly: every value is re-derived or
     validated from the loaded geometry and compared in selfTest().
     ---------------------------------------------------------------------- */
  const SPEC = Object.freeze({
    lengthM: 4.370, widthM: 1.994, heightM: 1.256,
    wheel: Object.freeze({
      radius: 0.325, width: 0.263, hubY: 0.324,
      wheelbase: 2.460, frontTrack: 1.568, rearTrack: 1.594,
      frontZ: 1.229, rearZ: -1.231
    }),
    // Body pitch/roll pivot (visual suspension). Wheels stay on the ground.
    bodyPivot: Object.freeze([0, 0.25, 0]),
    // Steering wheel rim: thin ring, r_outer 0.162 m, normal tilted 17 deg from horizontal.
    steeringWheel: Object.freeze({
      center: Object.freeze([0.3745, 0.7948, -0.0037]),
      axis: Object.freeze([0, 0.2950, -0.9555]),    // points at the driver
      rimOuterRadius: 0.162,
      // Selection envelopes (metres, in the wheel's own plane/axis frame)
      gen:   Object.freeze({ rad: 0.20,  axMin: -0.12,  axMax: 0.10 }),
      tight: Object.freeze({ rad: 0.166, axMin: -0.035, axMax: 0.06 }),
      lockToLockRatio: 13.5          // steering-wheel angle = road-wheel angle * ratio
    }),
    // Driver eye point, from ray-casting the real interior (docs/SUPRA_RIG_SPEC.md)
    eye:  Object.freeze([0.370, 1.021, -0.563]),
    hood: Object.freeze([0.000, 1.000,  1.007]),
    cabinClearance: Object.freeze({ upMin: 0.09, backMin: 0.06, backMax: 0.18, downMin: 0.25, leftMin: 0.20, fwdMin: 0.60 })
  });

  const TAU = Math.PI * 2;
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const matNames = m => (Array.isArray(m.material) ? m.material : [m.material]).map(x => (x && x.name) || '');

  /* ------------------------------------------------------------------------
     build(): rig the model. `wrapper` is the Group that holds the normalised
     (scaled, centred, grounded) GLB scene and must still be DETACHED, with
     identity world transform. Returns a rig whose `root` the caller adds to
     the vehicle container. The wrapper is re-parented inside rig.sprung.
     ---------------------------------------------------------------------- */
  function build(THREE, wrapper, opts) {
    opts = opts || {};
    const rig = { ok: false, errors: [], notes: [], spec: SPEC, wheels: [], calipers: [], sw: null,
                  spin: [0, 0, 0, 0], timings: {} };
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

    wrapper.updateMatrixWorld(true);
    const wInv = new THREE.Matrix4().copy(wrapper.matrixWorld).invert();
    const tmpBox = new THREE.Box3();
    function boxOf(obj) {                       // AABB in wrapper space
      tmpBox.setFromObject(obj);
      const b = tmpBox.clone();
      b.applyMatrix4(wInv);
      return b;
    }

    const meshes = [];
    wrapper.traverse(o => { if (o.isMesh) meshes.push(o); });

    /* ---- 1. wheel assemblies: found by material name 'tire', not by node name ---- */
    const assemblies = new Map();
    meshes.filter(m => matNames(m).includes('tire')).forEach(tire => {
      let node = tire;
      const p = tire.parent;
      if (p && p !== wrapper && p.children.length >= 2 && p.children.length <= 8 && p.children.every(c => c.isMesh)) node = p;
      if (!assemblies.has(node)) assemblies.set(node, tire);
    });
    if (assemblies.size !== 4) {
      rig.errors.push(`expected 4 wheel assemblies (material 'tire'), found ${assemblies.size}`);
      return rig;
    }

    const found = [];
    assemblies.forEach((tire, node) => {
      const b = boxOf(node), size = b.getSize(new THREE.Vector3()), hub = b.getCenter(new THREE.Vector3());
      found.push({ node, tire, hub, size, radius: (size.y + size.z) / 4, width: size.x,
                   front: hub.z > 0, left: hub.x > 0 });
    });
    // Fixed order: FL, FR, RL, RR  (left = +X)
    const order = w => (w.front ? 0 : 2) + (w.left ? 0 : 1);
    found.sort((a, b) => order(a) - order(b));
    const names = ['FL', 'FR', 'RL', 'RR'];
    for (let i = 0; i < 4; i++) {
      if (order(found[i]) !== i) { rig.errors.push('wheel layout is not 2 front + 2 rear / 2 left + 2 right'); return rig; }
      found[i].index = i; found[i].name = names[i];
    }

    /* ---- 2. hierarchy: root -> sprung(body) / unsprung(wheels) ---- */
    const cg = new THREE.Vector3().fromArray(SPEC.bodyPivot);
    const rootG = new THREE.Group();     rootG.name = 'SupraRigRoot';
    const sprung = new THREE.Group();    sprung.name = 'SupraSprung';
    const unsprung = new THREE.Group();  unsprung.name = 'SupraUnsprung';
    rootG.add(sprung); rootG.add(unsprung);
    sprung.position.copy(cg);
    wrapper.position.set(-cg.x, -cg.y, -cg.z);
    sprung.add(wrapper);
    rootG.updateMatrixWorld(true);

    /* ---- 3. wheel pivots: steer (about vertical axis through hub) -> spin (about axle) ---- */
    found.forEach(w => {
      const steer = new THREE.Group(); steer.name = `Supra_${w.name}_Steer`;
      const spin = new THREE.Group();  spin.name = `Supra_${w.name}_Spin`;
      steer.position.copy(w.hub);
      unsprung.add(steer); steer.add(spin);
      rootG.updateMatrixWorld(true);
      spin.attach(w.node);               // preserves the wheel's visible world transform exactly
      w.steer = steer; w.spin = spin; w.calipers = [];
      rig.wheels.push(w);
    });

    /* ---- 4. brake calipers: follow the wheel's steering, never its spin ---- */
    meshes.filter(m => matNames(m).includes('brake')).forEach(m => {
      const b = boxOf(m), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      if (Math.max(s.x, s.y, s.z) < 0.08) return;      // tiny 'brake'-material trim pieces are not calipers
      let best = null, bd = 1e9;
      rig.wheels.forEach(w => { const d = c.distanceTo(w.hub); if (d < bd) { bd = d; best = w; } });
      if (!best || bd > 0.30) return;
      let node = m;
      if (m.parent && m.parent !== wrapper && m.parent.children.length === 1) node = m.parent;
      rootG.updateMatrixWorld(true);
      best.steer.attach(node);
      best.calipers.push(node);
      rig.calipers.push({ node, wheel: best.name, dist: bd });
    });

    /* ---- 5. steering wheel: split the rim/hub/buttons out of merged meshes ---- */
    if (opts.steeringWheel === false) { rig.sw = null; rig.notes.push('steering wheel rig disabled by option'); }
    else {
      try { rig.sw = rigSteeringWheel(THREE, wrapper, meshes, wInv); }
      // A failed steering-wheel split must never take the wheels down with it: report and continue.
      catch (e) { rig.notes.push('steering wheel rig failed: ' + (e && e.message || e)); rig.swError = String(e && e.message || e); rig.sw = null; }
    }

    /* ---- 6. camera anchors ride on the sprung body ---- */
    rig.eyeAnchor = new THREE.Object3D();  rig.eyeAnchor.name = 'SupraEyeAnchor';
    rig.eyeAnchor.position.fromArray(SPEC.eye);   wrapper.add(rig.eyeAnchor);
    rig.hoodAnchor = new THREE.Object3D(); rig.hoodAnchor.name = 'SupraHoodAnchor';
    rig.hoodAnchor.position.fromArray(SPEC.hood); wrapper.add(rig.hoodAnchor);

    rig.root = rootG; rig.sprung = sprung; rig.unsprung = unsprung; rig.wrapper = wrapper;
    rig.cg = cg;
    rig.radius = rig.wheels.reduce((s, w) => s + w.radius, 0) / 4;
    rootG.updateMatrixWorld(true);
    rig.ok = rig.errors.length === 0;
    rig.timings.buildMs = now() - t0;
    return rig;
  }

  /* ------------------------------------------------------------------------
     Steering wheel extraction. The wheel's rim, hub pad and buttons are
     separate welded components, but are merged into meshes that also contain
     dash/cluster geometry. We find every connected component (vertices welded
     by position) that lies ENTIRELY inside a tight cylinder around the rim, and
     that does not touch any triangle leaving a slightly larger cylinder.
     Those triangles move to a new mesh (same vertex buffers, new index) under
     a pivot at the rim centre.
     ---------------------------------------------------------------------- */
  function rigSteeringWheel(THREE, wrapper, meshes, wInv) {
    const S = SPEC.steeringWheel;
    const c = new THREE.Vector3().fromArray(S.center);
    const n = new THREE.Vector3().fromArray(S.axis).normalize();
    const u = new THREE.Vector3(1, 0, 0);                       // in-plane: car left (n.x == 0)
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const out = { parts: [], triangles: 0, pivot: null, axis: n.clone(), center: c.clone(), ratio: S.lockToLockRatio, sourceMeshes: [] };

    const pivot = new THREE.Group(); pivot.name = 'SupraSteeringWheelPivot';
    pivot.position.copy(c);
    wrapper.add(pivot);
    wrapper.updateMatrixWorld(true);

    const mat = new THREE.Matrix4(), p = new THREE.Vector3(), d = new THREE.Vector3();
    const reach = S.gen.rad + 0.30;

    meshes.forEach(mesh => {
      const g = mesh.geometry, pos = g && g.getAttribute && g.getAttribute('position'), idxA = g && g.getIndex && g.getIndex();
      if (!pos || !idxA) return;
      mat.copy(wInv).multiply(mesh.matrixWorld);
      // cheap reject using the mesh's bounding box
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox.clone().applyMatrix4(mat);
      const closest = new THREE.Vector3(clampN(c.x, bb.min.x, bb.max.x), clampN(c.y, bb.min.y, bb.max.y), clampN(c.z, bb.min.z, bb.max.z));
      if (closest.distanceTo(c) > reach) return;

      const nv = pos.count, rad = new Float32Array(nv), ax = new Float32Array(nv);
      const wx = new Float32Array(nv), wy = new Float32Array(nv), wz = new Float32Array(nv);
      const inGen = new Uint8Array(nv), inTight = new Uint8Array(nv);
      for (let i = 0; i < nv; i++) {
        p.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mat);
        wx[i] = p.x; wy[i] = p.y; wz[i] = p.z;
        d.subVectors(p, c);
        const a = d.dot(n), r = Math.hypot(d.dot(u), d.dot(v));
        ax[i] = a; rad[i] = r;
        inGen[i] = (r <= S.gen.rad && a >= S.gen.axMin && a <= S.gen.axMax) ? 1 : 0;
        inTight[i] = (r <= S.tight.rad && a >= S.tight.axMin && a <= S.tight.axMax) ? 1 : 0;
      }
      const idx = idxA.array, nt = idx.length / 3;
      const wid = new Int32Array(nv).fill(-1), parent = [];
      const keyMap = new Map();
      const W = i => {
        if (wid[i] >= 0) return wid[i];
        const key = Math.round(wx[i] * 1e4) + ',' + Math.round(wy[i] * 1e4) + ',' + Math.round(wz[i] * 1e4);
        let id = keyMap.get(key);
        if (id === undefined) { id = parent.length; parent.push(id); keyMap.set(key, id); }
        wid[i] = id; return id;
      };
      const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
      const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

      const genTris = [], touched = [];
      for (let t = 0; t < nt; t++) {
        const a = idx[3 * t], b = idx[3 * t + 1], cc = idx[3 * t + 2];
        const ga = inGen[a], gb = inGen[b], gc = inGen[cc];
        if (!(ga | gb | gc)) continue;
        const wa = W(a), wb = W(b), wc = W(cc);
        if (ga && gb && gc) { union(wa, wb); union(wb, wc); genTris.push(t); }
        else touched.push(wa, wb, wc);
      }
      if (!genTris.length) return;
      const comp = new Map();
      genTris.forEach(t => {
        const a = idx[3 * t], b = idx[3 * t + 1], cc = idx[3 * t + 2];
        const r = find(W(a));
        let k = comp.get(r); if (!k) { k = { ok: true, tris: 0 }; comp.set(r, k); }
        k.tris++;
        if (!(inTight[a] && inTight[b] && inTight[cc])) k.ok = false;
      });
      touched.forEach(w => { const k = comp.get(find(w)); if (k) k.ok = false; });

      const wheelIdx = [], restIdx = [];
      let selectedTris = 0;
      const isWheel = new Uint8Array(nt);
      genTris.forEach(t => { const k = comp.get(find(W(idx[3 * t]))); if (k.ok && k.tris >= 4) isWheel[t] = 1; });
      for (let t = 0; t < nt; t++) {
        const tgt = isWheel[t] ? wheelIdx : restIdx;
        tgt.push(idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]);
        selectedTris += isWheel[t];
      }
      if (!selectedTris) return;

      // New mesh shares vertex attributes; only the index differs.
      const ng = new THREE.BufferGeometry();
      Object.keys(g.attributes).forEach(k => ng.setAttribute(k, g.attributes[k]));
      ng.setIndex(new THREE.BufferAttribute(new Uint32Array(wheelIdx), 1));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(restIdx), 1));
      g.boundingBox = null; g.boundingSphere = null;
      const part = new THREE.Mesh(ng, mesh.material);
      part.name = (mesh.name || 'mesh') + '_SteeringWheelPart';
      part.castShadow = mesh.castShadow; part.receiveShadow = mesh.receiveShadow;
      part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
      mesh.parent.add(part);
      wrapper.updateMatrixWorld(true);
      pivot.attach(part);
      out.parts.push(part);
      out.triangles += selectedTris;
      out.sourceMeshes.push({ name: mesh.name, material: matNames(mesh)[0], triangles: selectedTris, of: nt });
    });
    out.pivot = pivot;
    if (!out.parts.length) { wrapper.remove(pivot); throw new Error('no steering wheel geometry found in the expected envelope'); }
    return out;
  }
  function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ------------------------------------------------------------------------
     Per-frame pose + integration
     ---------------------------------------------------------------------- */
  // Visual Ackermann: `steer` is the road-wheel angle at the virtual centre wheel (rad, +left).
  function ackermann(steer, hubX, wheelbase) {
    const t = Math.tan(steer);
    const den = Math.max(0.2, 1 - hubX * t / wheelbase);
    return Math.atan(t / den);
  }

  // Advance each wheel's own rolling angle. v_i = vf - yawRate * x_i (inner wheels are slower).
  function integrate(rig, dt, vf, yawRate, handbrake) {
    if (!rig || !rig.ok) return;
    for (const w of rig.wheels) {
      const locked = handbrake && !w.front;
      if (!locked) {
        const v = vf - (yawRate || 0) * w.hub.x;
        rig.spin[w.index] = (rig.spin[w.index] + v * dt / w.radius) % TAU;
      }
    }
  }

  // Apply the pose. s = { steer, spin:[4]|undefined, pitch, roll, swSteer }
  function pose(rig, s) {
    if (!rig || !rig.ok) return;
    const spin = s.spin || rig.spin;
    const steer = s.steer || 0, L = SPEC.wheel.wheelbase;
    for (const w of rig.wheels) {
      w.steer.rotation.set(0, w.front ? ackermann(steer, w.hub.x, L) : 0, 0);
      w.spin.rotation.set(spin[w.index] || 0, 0, 0);
    }
    rig.sprung.rotation.set(s.pitch || 0, 0, s.roll || 0);
    if (rig.sw) {
      const lim = 7.0;                                  // about +-400 degrees
      const a = Math.max(-lim, Math.min(lim, (s.swSteer !== undefined ? s.swSteer : steer) * rig.sw.ratio));
      rig.sw.angle = a;
      rig.sw.pivot.quaternion.setFromAxisAngle(rig.sw.axis, a);
    }
  }

  // Fixed local camera orientation relative to an anchor (anchor +Z = car forward; camera looks down -Z).
  function cameraQuat(THREE, pitchDownRad) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.abs(pitchDownRad), Math.PI, 0, 'YXZ'));
  }

  /* ------------------------------------------------------------------------
     Self-test. Pure geometry/maths on the loaded rig. Returns an array of
     { id, name, status: PASS|FAIL|INFO|SKIP, detail }.
     ctx = { raycast: bool }
     ---------------------------------------------------------------------- */
  function selfTest(THREE, rig, ctx) {
    ctx = ctx || {};
    const R = [];
    const add = (id, name, ok, detail) => R.push({ id, name, status: ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL', detail });
    if (!rig || !rig.ok) {
      add('RIG', 'Rig built', false, rig ? rig.errors.join('; ') : 'no rig');
      return R;
    }
    const f3 = x => x.toFixed(3), f4 = x => x.toFixed(4);
    const root = rig.root;
    const saveSpin = rig.spin.slice();
    const savedSw = rig.sw ? rig.sw.angle : 0;
    const rinv = () => new THREE.Matrix4().copy(root.matrixWorld).invert();
    const toRoot = obj => { root.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld).applyMatrix4(rinv()); };
    const point = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };
    const zero = () => pose(rig, { steer: 0, spin: [0, 0, 0, 0], pitch: 0, roll: 0, swSteer: 0 });
    zero(); root.updateMatrixWorld(true);

    // G1/G2 size and grounding (whole rig)
    const bb = new THREE.Box3().setFromObject(root).applyMatrix4(rinv()), sz = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
    add('G1', 'Model size matches measured Supra (4.370 x 1.994 x 1.256 m)',
        near(sz.z, SPEC.lengthM, 0.01) && near(sz.x, SPEC.widthM, 0.01) && near(sz.y, SPEC.heightM, 0.01),
        `L ${f3(sz.z)}  W ${f3(sz.x)}  H ${f3(sz.y)} m`);
    add('G2', 'Grounded at y=0 and centred on X/Z', Math.abs(bb.min.y) < 0.01 && Math.abs(ctr.x) < 0.01 && Math.abs(ctr.z) < 0.01,
        `minY ${f4(bb.min.y)}  centre x ${f3(ctr.x)} z ${f3(ctr.z)}`);

    // O1 orientation from the model's own lights/plate
    const centreOfMat = names => {
      const b = new THREE.Box3(); let any = false;
      rig.wrapper.traverse(o => { if (o.isMesh && matNames(o).some(n => names.includes(n))) { b.expandByObject(o); any = true; } });
      return any ? b.applyMatrix4(rinv()).getCenter(new THREE.Vector3()) : null;
    };
    const tail = centreOfMat(['taillights']), plate = centreOfMat(['carplate']);
    let frontLightZ = null;
    rig.wrapper.traverse(o => { if (o.isMesh && matNames(o).includes('orange_light')) {
      const c = new THREE.Box3().setFromObject(o).applyMatrix4(rinv()).getCenter(new THREE.Vector3());
      if (frontLightZ === null || c.z > frontLightZ) frontLightZ = c.z; } });
    add('O1', 'Orientation: +Z is the front (lamps ahead, tail lamps/plate behind)',
        !!tail && !!plate && frontLightZ !== null && tail.z < -1.5 && plate.z < -1.5 && frontLightZ > 1.5,
        `front lamp z ${frontLightZ === null ? '?' : f3(frontLightZ)}  tail lamp z ${tail ? f3(tail.z) : '?'}  plate z ${plate ? f3(plate.z) : '?'}`);

    // W1..W3 wheel layout and geometry
    const W = rig.wheels, FL = W[0], FR = W[1], RL = W[2], RR = W[3];
    add('W1', 'Four wheel assemblies found by material (FL FR RL RR)', W.length === 4, W.map(w => `${w.name}@(${f3(w.hub.x)},${f3(w.hub.z)})`).join('  '));
    add('W2', 'Wheel radius 0.325 m and hub height = radius (tyres touch the ground)',
        W.every(w => near(w.radius, SPEC.wheel.radius, 0.008) && near(w.hub.y, w.radius, 0.012)),
        W.map(w => `${w.name} r=${f3(w.radius)} hubY=${f3(w.hub.y)}`).join('  '));
    const wb = FL.hub.z - RL.hub.z, trF = FL.hub.x - FR.hub.x, trR = RL.hub.x - RR.hub.x;
    add('W3', 'Wheelbase 2.46 m, tracks plausible, left/right symmetric',
        near(wb, SPEC.wheel.wheelbase, 0.04) && near(trF, SPEC.wheel.frontTrack, 0.03) && near(trR, SPEC.wheel.rearTrack, 0.03) &&
        near(FL.hub.x, -FR.hub.x, 0.02) && near(RL.hub.x, -RR.hub.x, 0.02),
        `wheelbase ${f3(wb)}  front track ${f3(trF)}  rear track ${f3(trR)}`);

    // W4 hub centre accuracy: tyre vertices must all lie within r of the axle line through the hub
    const wm = new THREE.Matrix4(), tp = new THREE.Vector3();
    const worst = W.map(w => {
      const g = w.tire.geometry, pos = g.getAttribute('position');
      root.updateMatrixWorld(true);
      wm.copy(rinv()).multiply(w.tire.matrixWorld);
      let rmax = 0, ymin = 1e9, xmin = 1e9, xmax = -1e9;
      for (let i = 0; i < pos.count; i++) {
        tp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(wm);
        const r = Math.hypot(tp.y - w.hub.y, tp.z - w.hub.z);
        if (r > rmax) rmax = r; if (tp.y < ymin) ymin = tp.y; if (tp.x < xmin) xmin = tp.x; if (tp.x > xmax) xmax = tp.x;
      }
      return { name: w.name, rmax, ymin, axleOff: (xmin + xmax) / 2 - w.hub.x };
    });
    add('W4', 'Hub pivot is the true tyre centre (outer radius uniform about the axle, lowest point at road level)',
        worst.every(x => near(x.rmax, SPEC.wheel.radius, 0.006) && Math.abs(x.ymin) < 0.012 && Math.abs(x.axleOff) < 0.01),
        worst.map(x => `${x.name} rmax=${f4(x.rmax)} lowY=${f4(x.ymin)}`).join('  '));

    // W5 rolling direction + axle invariance
    {
      const m = W.map(w => ({ w, top: point(w.spin, 0, w.radius, 0), hub: point(w.spin, 0, 0, 0) }));
      const before = m.map(o => toRoot(o.top));
      pose(rig, { steer: 0, spin: [0.1, 0.1, 0.1, 0.1], pitch: 0, roll: 0, swSteer: 0 });
      const after = m.map(o => toRoot(o.top)), hubs = m.map(o => toRoot(o.hub));
      const fwd = after.every((a, i) => a.z - before[i].z > 0.02 && a.y < before[i].y);
      const keep = m.every((o, i) => near(after[i].distanceTo(hubs[i]), o.w.radius, 1e-6) && hubs[i].distanceTo(o.w.hub) < 1e-6);
      add('W5', 'Rolling: +spin moves the tyre top FORWARD (+Z), about the axle, hub stays fixed', fwd && keep,
          `dz(top)=${f4(after[0].z - before[0].z)}  radius kept=${keep}`);
      m.forEach(o => { o.top.parent.remove(o.top); o.hub.parent.remove(o.hub); });
    }

    // W6 steering direction, front only, Ackermann; W7 axle direction/spin independence
    {
      const front = [FL, FR].map(w => ({ w, nose: point(w.spin, 0, 0, w.radius), axle: point(w.spin, 1, 0, 0), hub: point(w.spin, 0, 0, 0) }));
      const rear = [RL, RR].map(w => ({ w, nose: point(w.spin, 0, 0, w.radius) }));
      zero(); const f0 = front.map(o => toRoot(o.nose)), r0 = rear.map(o => toRoot(o.nose));
      const delta = 0.30;
      pose(rig, { steer: delta, spin: [0, 0, 0, 0], pitch: 0, roll: 0, swSteer: 0 });
      const f1 = front.map(o => toRoot(o.nose)), r1 = rear.map(o => toRoot(o.nose));
      const turnsLeft = f1.every((p, i) => p.x - f0[i].x > 0.05 && near(p.y, f0[i].y, 1e-6));
      const rearFixed = r1.every((p, i) => p.distanceTo(r0[i]) < 1e-9);
      const angs = front.map((o, i) => Math.atan2(f1[i].x - toRoot(o.hub).x, f1[i].z - toRoot(o.hub).z));
      add('W6', 'Steering left (+) turns the FRONT wheels toward +X (car left); rear wheels do not steer',
          turnsLeft && rearFixed, `FL ${(angs[0] * 57.2958).toFixed(2)} deg  FR ${(angs[1] * 57.2958).toFixed(2)} deg  rear moved=${!rearFixed}`);
      add('W6b', 'Ackermann: inner (left) wheel steers more than outer in a left turn', angs[0] > angs[1] && angs[1] > 0,
          `inner ${(angs[0] * 57.2958).toFixed(2)} > outer ${(angs[1] * 57.2958).toFixed(2)} deg (centre ${(delta * 57.2958).toFixed(2)})`);
      pose(rig, { steer: delta, spin: [1.3, 1.3, 1.3, 1.3], pitch: 0, roll: 0, swSteer: 0 });
      const ok7 = front.every((o, i) => {
        const a = toRoot(o.axle).sub(toRoot(o.hub)).normalize(), th = angs[i];
        return near(a.x, Math.cos(th), 1e-6) && near(a.z, -Math.sin(th), 1e-6) && Math.abs(a.y) < 1e-9;
      });
      add('W7', 'Steer and spin are independent: axle direction depends only on steering, not rolling', ok7, 'axle = Ry(steer)·X for any spin');
      front.forEach(o => { [o.nose, o.axle, o.hub].forEach(x => x.parent.remove(x)); }); rear.forEach(o => o.nose.parent.remove(o.nose));
    }

    // W8 calipers
    {
      const cal = rig.calipers;
      const front = cal.filter(c => c.wheel[0] === 'F'), rearC = cal.filter(c => c.wheel[0] === 'R');
      // Use the caliper's geometric centre (a node's own origin sits at the model origin, not at the caliper).
      const cen = c => { root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(c.node).applyMatrix4(rinv()).getCenter(new THREE.Vector3()); };
      zero(); const p0 = cal.map(cen);
      pose(rig, { steer: 0.3, spin: [0, 0, 0, 0], pitch: 0, roll: 0, swSteer: 0 });
      const p1 = cal.map(cen);
      const mvF = cal.map((c, i) => c.wheel[0] === 'F' ? p1[i].distanceTo(p0[i]) : 0), mvR = cal.map((c, i) => c.wheel[0] === 'R' ? p1[i].distanceTo(p0[i]) : 0);
      pose(rig, { steer: 0, spin: [2, 2, 2, 2], pitch: 0, roll: 0, swSteer: 0 });
      const p2 = cal.map(cen), spinMove = Math.max(...p2.map((p, i) => p.distanceTo(p0[i])));
      add('W8', '4 brake calipers: front ones steer with the wheel, none spin',
          cal.length === 4 && front.length === 2 && rearC.length === 2 && Math.min(...mvF.filter((_, i) => cal[i].wheel[0] === 'F')) > 0.005 && Math.max(...mvR) < 1e-9 && spinMove < 1e-9,
          `found ${cal.length} (F${front.length}/R${rearC.length})  front moved ${Math.max(...mvF).toFixed(3)} m at 17 deg  rear moved ${Math.max(...mvR).toExponential(1)}  spin moved ${spinMove.toExponential(1)}`);
    }

    // B1 sprung/unsprung split
    {
      const roof = point(rig.wrapper, 0, 1.2, 0), hubs0 = W.map(w => toRoot(w.steer));
      zero(); const roof0 = toRoot(roof);
      pose(rig, { steer: 0, spin: [0, 0, 0, 0], pitch: 0.03, roll: 0.035, swSteer: 0 });
      const roof1 = toRoot(roof), hubs1 = W.map(w => toRoot(w.steer));
      const hubDrift = Math.max(...hubs1.map((h, i) => h.distanceTo(hubs0[i])));
      add('B1', 'Body pitch/roll leaves the wheels on the ground (wheels are unsprung)', hubDrift < 1e-9 && roof1.distanceTo(roof0) > 0.02,
          `hub drift ${hubDrift.toExponential(1)} m  roof moved ${roof1.distanceTo(roof0).toFixed(3)} m`);
      roof.parent.remove(roof);
    }

    // S1 steering wheel
    if (rig.sw) {
      const sw = rig.sw, ax = sw.axis, c0 = sw.center;
      zero();
      const probes = sw.parts.slice(0, 3).map(part => {
        const pos = part.geometry.getAttribute('position'); const idx = part.geometry.getIndex();
        const i = idx.array[0]; const m = new THREE.Matrix4().copy(rinv()).multiply(part.matrixWorld);
        return { part, local: new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)), m0: m };
      });
      const pt = pr => { root.updateMatrixWorld(true); return pr.local.clone().applyMatrix4(new THREE.Matrix4().copy(rinv()).multiply(pr.part.matrixWorld)); };
      const b = probes.map(pt);
      pose(rig, { steer: 0, spin: [0, 0, 0, 0], pitch: 0, roll: 0, swSteer: 0.4 });   // 0.4 rad road wheel -> 5.4 rad wheel
      const a = probes.map(pt);
      const radial = (pnt) => { const d = pnt.clone().sub(c0); const along = d.dot(ax); return { along, r: d.clone().addScaledVector(ax, -along).length() }; };
      let kept = true;
      for (let i = 0; i < probes.length; i++) { const r0 = radial(b[i]), r1 = radial(a[i]); if (!near(r0.along, r1.along, 1e-5) || !near(r0.r, r1.r, 1e-5)) kept = false; }
      const moved = a.some((p, i) => p.distanceTo(b[i]) > 0.01);
      add('S1', 'Steering wheel rotates about the column axis (distance and depth preserved)', kept && moved,
          `${sw.parts.length} part meshes, ${sw.triangles} triangles; sample points moved=${moved}`);
      const nTri = sw.triangles;
      add('S2', 'Steering wheel selection is plausible (rim + hub + buttons: 6k–60k triangles)', nTri >= 6000 && nTri <= 60000,
          sw.sourceMeshes.map(s => `${s.material}:${s.triangles}/${s.of}`).join('  '));
      // S3 sign: a point at the top of the rim (in-plane 'up' = (0, 0.9555, 0.295) * 0.15 m) must move toward +X
      // (car left) when steering left, i.e. counter-clockwise as seen by the driver.
      const holder = point(sw.pivot, 0, 0.1433, 0.0443);     // pivot-local offset from the rim centre
      zero(); const t0p = toRoot(holder);
      pose(rig, { steer: 0, spin: [0, 0, 0, 0], pitch: 0, roll: 0, swSteer: 0.1 });
      const t1p = toRoot(holder);
      add('S3', 'Steering left turns the wheel counter-clockwise for the driver (top of rim moves to car-left, +X)', t1p.x - t0p.x > 0.001,
          `top-of-rim dx=${(t1p.x - t0p.x).toFixed(4)} for ${(0.1 * rig.sw.ratio).toFixed(2)} rad`);
      holder.parent.remove(holder);
    } else {
      add('S1', 'Steering wheel rig', false, 'not available: ' + rig.errors.join('; '));
    }

    // E1/H1 cabin camera clearances by ray-casting the actual interior
    if (ctx.raycast) {
      const rc = new THREE.Raycaster(), q = new THREE.Quaternion();
      zero(); root.updateMatrixWorld(true);
      root.getWorldQuaternion(q);
      const cast = (anchor, dir) => {
        const o = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld);
        const dv = new THREE.Vector3().fromArray(dir).applyQuaternion(q).normalize();
        rc.set(o, dv); rc.far = 3;
        const hits = rc.intersectObject(rig.wrapper, true);
        return hits.length ? { d: hits[0].distance, name: hits[0].object.parent && hits[0].object.parent.name ? hits[0].object.name : hits[0].object.name } : null;
      };
      const CC = SPEC.cabinClearance;
      const e = { up: cast(rig.eyeAnchor, [0, 1, 0]), down: cast(rig.eyeAnchor, [0, -1, 0]), back: cast(rig.eyeAnchor, [0, 0, -1]),
                  fwd: cast(rig.eyeAnchor, [0, 0, 1]), left: cast(rig.eyeAnchor, [1, 0, 0]) };
      const g = k => e[k] ? e[k].d : 99;
      const okEye = g('up') >= CC.upMin && g('back') >= CC.backMin && g('back') <= CC.backMax && g('down') >= CC.downMin && g('left') >= CC.leftMin && g('fwd') >= CC.fwdMin;
      add('E1', 'Cockpit eye point is inside the cabin with sensible clearances',
          okEye, `up ${f3(g('up'))} (>=${CC.upMin})  back ${f3(g('back'))} (${CC.backMin}-${CC.backMax})  down ${f3(g('down'))}  left ${f3(g('left'))}  forward ${f3(g('fwd'))}`);
      const hood = cast(rig.hoodAnchor, [0, -1, 0]);
      add('H1', 'Hood camera floats 8–30 cm above the bonnet', !!hood && hood.d >= 0.08 && hood.d <= 0.30, hood ? `${f3(hood.d)} m above ${hood.name}` : 'no surface below');
    } else {
      R.push({ id: 'E1', name: 'Cockpit eye clearances (ray-cast)', status: 'SKIP', detail: 'run with raycast enabled (verification panel button)' });
    }

    // restore
    rig.spin = saveSpin;
    pose(rig, { steer: 0, spin: saveSpin, pitch: 0, roll: 0, swSteer: savedSw });
    root.updateMatrixWorld(true);
    return R;
  }

  /* ------------------------------------------------------------------------
     Material audit: which GLB material extensions did THIS Three.js build apply?
     json = gltf.parser.json
     ---------------------------------------------------------------------- */
  function materialAudit(THREE, wrapper, json) {
    const byName = new Map();
    wrapper.traverse(o => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if (!m) return;
        const e = byName.get(m.name) || { mat: m, meshes: 0 }; e.meshes++; byName.set(m.name, e);
      });
    });
    const rows = [];
    ((json && json.materials) || []).forEach(def => {
      const ext = Object.keys(def.extensions || {});
      const e = byName.get(def.name); const m = e && e.mat;
      const row = { name: def.name, meshes: e ? e.meshes : 0, extensions: ext, type: m ? m.type : '(unused)', notes: [] };
      if (m) {
        if (ext.includes('KHR_materials_clearcoat')) {
          const want = def.extensions.KHR_materials_clearcoat.clearcoatFactor;
          const has = 'clearcoat' in m;
          row.notes.push(has ? `clearcoat ${m.clearcoat} (file ${want}) -> ${m.clearcoat > 0 ? 'APPLIED' : 'NOT applied'}` : 'clearcoat property missing -> NOT supported');
          row.clearcoatApplied = has && m.clearcoat > 0;
        }
        if (ext.includes('KHR_materials_emissive_strength')) {
          const want = def.extensions.KHR_materials_emissive_strength.emissiveStrength;
          row.notes.push(`emissiveStrength file ${want} vs applied ${m.emissiveIntensity} -> ${near(m.emissiveIntensity, want, 0.01) ? 'APPLIED' : 'NOT applied (clamped to x1)'}`);
        }
        if (ext.includes('KHR_materials_specular')) {
          row.notes.push(('specularIntensity' in m) ? 'specularIntensity supported' : 'specular factor NOT supported (default F0 used)');
        }
        row.map = !!m.map; row.opacity = m.opacity; row.transparent = !!m.transparent;
      }
      rows.push(row);
    });
    return rows;
  }

  return { SPEC, build, pose, integrate, ackermann, selfTest, materialAudit, cameraQuat, rigSteeringWheel };
});
