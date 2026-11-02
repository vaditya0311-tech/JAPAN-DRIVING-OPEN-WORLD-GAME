/* ============================================================================
   verify_panel.js — in-browser Supra verification panel.
   Open with  ?verify=1  or press F9.  Nothing here changes gameplay unless you press its buttons.
   It runs the same self-tests as tools/test_supra_rig.js on the LIVE loaded model, measures the
   renderer/material facts only a real browser can show, runs a scripted drive test through the
   real input path, and exports everything as a JSON report you can send back.
   ========================================================================== */
(function () {
  'use strict';
  const J = window.JDU;
  if (!J) { console.warn('verify_panel: JDU hook missing'); return; }
  const THREE = J.THREE;
  const report = { generated: null, notes: [], selfTests: [], materials: [], drive: null, env: {} };

  /* ---------- DOM ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #vp{position:fixed;top:8px;right:8px;width:440px;max-height:94vh;overflow:auto;z-index:99999;background:rgba(8,10,14,.93);color:#d7dde6;
      font:11px/1.4 ui-monospace,Consolas,Menlo,monospace;border:1px solid #3a4658;border-radius:6px;padding:8px 10px;display:none}
  #vp h3{margin:6px 0 4px;font-size:11px;color:#8fd3ff;letter-spacing:.08em}
  #vp button{font:inherit;background:#1d2633;color:#d7dde6;border:1px solid #3a4658;border-radius:4px;padding:3px 7px;margin:2px 2px 2px 0;cursor:pointer}
  #vp button:hover{background:#2a3648} #vp button.on{background:#27506b;border-color:#6bb8e8}
  #vp .pass{color:#7cff6a} #vp .fail{color:#ff6b6b;font-weight:bold} #vp .skip,#vp .info{color:#ffd36b}
  #vp .row{border-top:1px solid #1e2631;padding:2px 0} #vp .d{color:#8a96a8;margin-left:34px;word-break:break-word}
  #vp .mat{cursor:pointer} #vp .mat.hidden{opacity:.35;text-decoration:line-through}
  #vp pre{white-space:pre-wrap;margin:0;color:#aab4c3}
  #vp .x{float:right;cursor:pointer;color:#8a96a8}`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.id = 'vp';
  el.innerHTML = `<span class="x" id="vpx">[F9 close]</span><b>SUPRA VERIFICATION</b>
    <div id="vpenv"></div>
    <h3>ACTIONS</h3>
    <div>
      <button id="vpTest">Run self-tests</button><button id="vpRay">+ cabin ray-casts</button>
      <button id="vpDrive">Drive test (10 s)</button><button id="vpSweep">Wheel sweep (static)</button>
    </div><div>
      <button id="vpMark">Rig markers</button><button id="vpPaint">Paint: tuned</button>
      <button id="vpHide">Hide body (see wheels)</button>
    </div><div>
      Camera: <button data-c="0">Chase</button><button data-c="1">Cockpit</button><button data-c="2">Hood</button><button data-c="3">Walkaround</button>
    </div><div>
      <button id="vpDl">Download report.json</button><button id="vpCopy">Copy report</button>
    </div>
    <h3>SELF-TESTS</h3><div id="vpres">(not run yet)</div>
    <h3>DRIVE TEST</h3><div id="vpdrv">(not run yet)</div>
    <h3>MATERIALS (what this Three.js build applied) — click a row to hide/show its meshes</h3><div id="vpmat"></div>`;
  document.body.appendChild(el);
  const $ = id => el.querySelector('#' + id);
  const open = v => { el.style.display = v ? 'block' : 'none'; if (v) refreshEnv(); };
  window.addEventListener('keydown', e => { if (e.code === 'F9') { e.preventDefault(); open(el.style.display !== 'block'); } });
  $('vpx').onclick = () => open(false);
  if (/[?&]verify=1/.test(location.search)) open(true);

  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* ---------- environment ---------- */
  function glInfo() {
    try {
      const gl = J.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { version: gl.getParameter(gl.VERSION), gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '(hidden)', maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    } catch (e) { return { error: String(e) }; }
  }
  function refreshEnv() {
    const P = J.P, g = glInfo();
    report.env = { three: THREE.REVISION, ua: navigator.userAgent, dpr: devicePixelRatio, viewport: innerWidth + 'x' + innerHeight, gl: g,
      modelState: P.modelState, modelError: P.modelError, rig: !!P.rig, rigErrors: P.rigErrors || [], paintMode: P.paintMode, camera: J.S.cam, state: J.S.state };
    $('vpenv').innerHTML = `<pre>Three.js r${THREE.REVISION}   ${esc(g.version || '')}
GPU: ${esc(g.gpu || g.error || '?')}   viewport ${innerWidth}x${innerHeight} @${devicePixelRatio}x
model: ${P.modelState}${P.modelError ? ' (' + esc(P.modelError) + ')' : ''}   rig: ${P.rig ? 'OK' : 'NOT BUILT ' + esc((P.rigErrors || []).join('; '))}
steering wheel rigged: ${P.rig && P.rig.sw ? 'yes (' + P.rig.sw.triangles + ' tris)' : 'no'}   game state: ${J.S.state}</pre>`;
  }

  /* ---------- self-tests ---------- */
  function runTests(ray) {
    const P = J.P;
    if (!P.rig) { $('vpres').innerHTML = '<span class="fail">No rig: ' + esc((P.rigErrors || ['model not loaded']).join('; ')) + '</span>'; return; }
    const t0 = performance.now();
    const res = SupraRig.selfTest(THREE, P.rig, { raycast: !!ray });
    // Browser-only checks
    const extra = [];
    extra.push({ id: 'B-CSS', name: 'Fake 2D cockpit overlay is hidden (real GLB interior is used)',
      status: getComputedStyle(document.getElementById('cockpitFX')).display === 'none' ? 'PASS' : 'FAIL', detail: 'body.realcockpit=' + document.body.classList.contains('realcockpit') });
    {   // vehicle orientation: physics heading h must make the model's +Z point along (sin h, 0, cos h)
      const car = J.car, oldH = P.g.rotation.y; const v = new THREE.Vector3(), q = new THREE.Quaternion(); let ok = true, det = [];
      for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
        P.g.rotation.y = h; P.g.updateMatrixWorld(true);
        P.rig.eyeAnchor.getWorldQuaternion(q); v.set(0, 0, 1).applyQuaternion(q);
        const ex = Math.sin(h), ez = Math.cos(h); if (Math.abs(v.x - ex) > 1e-4 || Math.abs(v.z - ez) > 1e-4) ok = false; det.push(h.toFixed(2) + '→(' + v.x.toFixed(2) + ',' + v.z.toFixed(2) + ')');
      }
      P.g.rotation.y = oldH; P.g.updateMatrixWorld(true);
      extra.push({ id: 'B-ORI', name: 'Model forward matches the physics heading convention (forward = (sin h, cos h))', status: ok ? 'PASS' : 'FAIL', detail: det.join('  ') });
    }
    {   // cockpit camera forward really points along the car's forward
      const P2 = J.P, cam = new THREE.Quaternion(), a = new THREE.Quaternion(); P2.rig.eyeAnchor.getWorldQuaternion(a);
      cam.copy(a).multiply(P2.rigCamQ.cockpit); const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam), cf = new THREE.Vector3(0, 0, 1).applyQuaternion(a);
      const deg = Math.acos(Math.max(-1, Math.min(1, f.dot(cf)))) * 57.2958;
      extra.push({ id: 'B-CAM', name: 'Cockpit camera looks along the car forward (small deliberate pitch-down only)', status: deg > 0.5 && deg < 5 ? 'PASS' : 'FAIL', detail: deg.toFixed(2) + ' deg from car forward' });
    }
    {   // loader outcome for the paint's clearcoat
      const cc = (report.materials || []).filter(m => m.extensions.includes('KHR_materials_clearcoat') && m.name !== 'carpaint');
      const applied = cc.length && cc.every(m => m.clearcoatApplied);
      extra.push({ id: 'M-CC', name: 'KHR_materials_clearcoat is applied by this Three.js build (carbon, mirror, glass)', status: cc.length ? (applied ? 'PASS' : 'FAIL') : 'SKIP', detail: cc.map(m => m.name + ':' + (m.clearcoatApplied ? 'yes' : 'no')).join(' ') });
    }
    const all = res.concat(extra);
    report.selfTests = all; report.generated = new Date().toISOString();
    const fails = all.filter(r => r.status === 'FAIL').length;
    $('vpres').innerHTML = `<div>${all.filter(r => r.status === 'PASS').length} pass, <span class="${fails ? 'fail' : 'pass'}">${fails} fail</span>, ${all.filter(r => r.status !== 'PASS' && r.status !== 'FAIL').length} skipped  (${(performance.now() - t0).toFixed(0)} ms)</div>` +
      all.map(r => `<div class="row"><span class="${r.status.toLowerCase()}">${r.status}</span> ${r.id} ${esc(r.name)}<div class="d">${esc(r.detail)}</div></div>`).join('');
  }
  $('vpTest').onclick = () => { buildMatList(); runTests(false); };
  $('vpRay').onclick = () => { buildMatList(); runTests(true); };

  /* ---------- materials ---------- */
  function buildMatList() {
    const P = J.P; report.materials = P.materialAudit || [];
    $('vpmat').innerHTML = report.materials.map((m, i) =>
      `<div class="row mat" data-i="${i}"><b>${esc(m.name)}</b> ×${m.meshes} <span class="d" style="margin:0">${esc(m.type)} ${m.extensions.map(e => e.replace('KHR_materials_', '')).join(',')}</span>` +
      (m.notes.length ? `<div class="d">${m.notes.map(esc).join('<br>')}</div>` : '') + '</div>').join('');
    $('vpmat').querySelectorAll('.mat').forEach(r => r.onclick = () => {
      const name = report.materials[+r.dataset.i].name, hide = !r.classList.contains('hidden'); r.classList.toggle('hidden', hide);
      (P.rig ? P.rig.root : P.modelContainer).traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some(m => m && m.name === name)) o.visible = !hide; } });
    });
  }

  /* ---------- camera / paint / body / markers ---------- */
  el.querySelectorAll('button[data-c]').forEach(b => b.onclick = () => J.setCam(+b.dataset.c));
  $('vpPaint').onclick = () => { const P = J.P; setPaintMode(P.paintMode === 'tuned' ? 'original' : 'tuned'); $('vpPaint').textContent = 'Paint: ' + P.paintMode; };
  let bodyHidden = false;
  $('vpHide').onclick = () => {
    const P = J.P; if (!P.rig) return; bodyHidden = !bodyHidden; $('vpHide').classList.toggle('on', bodyHidden);
    const wheelNodes = new Set(); P.rig.wheels.forEach(w => w.steer.traverse(o => wheelNodes.add(o)));
    P.rig.wrapper.traverse(o => { if (o.isMesh && !wheelNodes.has(o)) o.visible = !bodyHidden; });
  };
  let markerObjs = null;
  $('vpMark').onclick = () => {
    const P = J.P; if (!P.rig) return;
    if (markerObjs) { markerObjs.forEach(o => o.parent && o.parent.remove(o)); markerObjs = null; $('vpMark').classList.remove('on'); return; }
    markerObjs = [];
    const add = (parent, obj) => { obj.renderOrder = 999; parent.add(obj); markerObjs.push(obj); };
    P.rig.wheels.forEach(w => {
      const ax = new THREE.AxesHelper(0.45); ax.material.depthTest = false; add(w.spin, ax);            // rolls with the wheel: X axle (red), Y up (green), Z fwd (blue)
      const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false }));
      add(w.steer, ray);                                                                              // cyan = steering axis (steers, never rolls)
    });
    add(P.rig.eyeAnchor, new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false })));   // magenta = driver eye
    if (P.rig.sw) { const ar = new THREE.ArrowHelper(P.rig.sw.axis, P.rig.sw.center, 0.5, 0xffaa00); ar.line.material.depthTest = false; add(P.rig.wrapper, ar); }   // orange = steering column axis
    $('vpMark').classList.add('on');
  };

  /* ---------- static wheel sweep (visual) ---------- */
  let sweepOn = false, sweepRaf = 0;
  $('vpSweep').onclick = () => {
    const P = J.P; if (!P.rig) return; sweepOn = !sweepOn; $('vpSweep').classList.toggle('on', sweepOn);
    cancelAnimationFrame(sweepRaf);
    if (!sweepOn) { window.JDU_SWEEP = null; return; }
    const t0 = performance.now(), spin = [0, 0, 0, 0]; window.JDU_SWEEP = { steer: 0, spin };
    (function loop() { const t = (performance.now() - t0) / 1000; window.JDU_SWEEP.steer = 0.5 * Math.sin(t * 0.9); const s = 3 * Math.sin(t * 0.35) ; for (let i = 0; i < 4; i++) spin[i] = s * 2; sweepRaf = requestAnimationFrame(loop); })();
  };

  /* ---------- scripted drive test through the real input path ---------- */
  let driving = false;
  $('vpDrive').onclick = () => {
    const P = J.P, car = J.car, keys = J.keys, S = J.S; if (!P.rig || driving) return;
    if (S.state !== 'play') { J.resetCar(); J.start(); }
    J.setCam(0);
    driving = true; $('vpDrive').classList.add('on'); $('vpdrv').innerHTML = 'running…';
    const phases = [
      { name: 'accelerate straight', t: 2.0, keys: ['KeyW'] },
      { name: 'steer LEFT',          t: 1.2, keys: ['KeyW', 'KeyA'] },
      { name: 'steer RIGHT',         t: 1.2, keys: ['KeyW', 'KeyD'] },
      { name: 'brake (then reverse)', t: 2.5, keys: ['KeyS'] },
      { name: 'reverse',             t: 2.0, keys: ['KeyS'] },
      { name: 'coast',               t: 1.0, keys: [] }
    ];
    const RL = P.rig.wheels[2], FL = P.rig.wheels[0], FR = P.rig.wheels[1];
    const R = phases.map(p => ({ name: p.name, h0: 0, h1: 0, vMax: -1e9, vMin: 1e9, steerFL: 0, steerFR: 0, spinDelta: 0, distDelta: 0, n: 0, dSpin: 0 }));
    let pi = -1, tPhase = 0, last = performance.now(), prevSpin = P.rig.spin[2], prevDist = car.dist, startPos = [car.x, car.z];
    let bumped = false;
    function setKeys(list) { ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach(k => keys[k] = list.includes(k)); }
    function step(now) {
      const dt = (now - last) / 1000; last = now;
      if (pi < 0 || tPhase >= phases[pi].t) {
        if (pi >= 0) R[pi].h1 = car.h;
        pi++; tPhase = 0;
        if (pi >= phases.length) return finish();
        setKeys(phases[pi].keys); R[pi].h0 = car.h;
      }
      tPhase += dt;
      const r = R[pi], vf = car.vf || 0;
      r.vMax = Math.max(r.vMax, vf); r.vMin = Math.min(r.vMin, vf);
      if (r.stopT === undefined && pi === 3 && vf <= 0.5) r.stopT = tPhase;   // first moment the car is (nearly) stopped
      r.n++; r.steerFL = Math.max(r.steerFL, Math.abs(FL.steer.rotation.y)); r.steerFR = Math.max(r.steerFR, Math.abs(FR.steer.rotation.y));
      r.signFL = Math.sign(FL.steer.rotation.y) || r.signFL;
      let d = P.rig.spin[2] - prevSpin; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;   // unwrap
      r.dSpin += d; prevSpin = P.rig.spin[2];
      r.distDelta += car.dist - prevDist; prevDist = car.dist;
      requestAnimationFrame(step);
    }
    function finish() {
      setKeys([]); driving = false; $('vpDrive').classList.remove('on');
      const rad = RL.radius, out = []; const chk = (name, ok, detail) => out.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
      R.forEach(r => { r.h1 = r.h1 || car.h; });
      chk('Accelerates forward', R[0].vMax > 8, `peak ${(R[0].vMax * 3.6).toFixed(0)} km/h in 2 s`);
      chk('Rolling distance = road distance (rear-left wheel, forward phases)', (() => { const sd = R[0].dSpin * rad, dd = R[0].distDelta; return dd > 5 && Math.abs(sd - dd) / dd < 0.03; })(),
        `wheel ${(R[0].dSpin * rad).toFixed(2)} m vs road ${R[0].distDelta.toFixed(2)} m`);
      const dhL = R[1].h1 - R[1].h0, dhR = R[2].h1 - R[2].h0;
      chk('Left key: heading turns LEFT (+h) and front wheels visibly turn left', dhL > 0.02 && R[1].signFL > 0 && R[1].steerFL > 0.01, `Δheading ${(dhL * 57.3).toFixed(1)}°, FL steer max ${(R[1].steerFL * 57.3).toFixed(1)}°`);
      chk('Right key: heading turns RIGHT (-h) and front wheels visibly turn right', dhR < -0.02 && R[2].signFL < 0 && R[2].steerFL > 0.01, `Δheading ${(dhR * 57.3).toFixed(1)}°, FL steer max ${(R[2].steerFL * 57.3).toFixed(1)}°`);
      chk('Steering angle is reduced at speed (speed-sensitive)', R[1].steerFL < 0.25, `max visual FL angle at speed ${(R[1].steerFL * 57.3).toFixed(1)}° (standstill limit ≈ ${(0.5 * 57.3).toFixed(0)}° × sensitivity)`);
      chk('Brakes to a stop (speed reaches ~0 within the brake phase)', R[3].stopT !== undefined, R[3].stopT !== undefined ? `stopped after ${R[3].stopT.toFixed(2)} s of braking from ${(R[2].vMax * 3.6).toFixed(0)} km/h` : 'never stopped');
      chk('Reverses (negative speed, wheels roll backwards)', R[4].vMin < -1.0 && R[4].dSpin < 0, `peak reverse ${(R[4].vMin * 3.6).toFixed(1)} km/h, wheel Δangle ${R[4].dSpin.toFixed(2)} rad`);
      chk('No NaN in the rig pose', P.rig.wheels.every(w => isFinite(w.steer.rotation.y) && isFinite(w.spin.rotation.x)), 'all finite');
      report.drive = { phases: R, checks: out, distanceFromStart: Math.hypot(car.x - startPos[0], car.z - startPos[1]), note: 'If the car hit scenery during the test, speed/heading figures are affected — rerun in an open street.' };
      $('vpdrv').innerHTML = out.map(r => `<div class="row"><span class="${r.status.toLowerCase()}">${r.status}</span> ${esc(r.name)}<div class="d">${esc(r.detail)}</div></div>`).join('') +
        '<div class="d" style="margin:4px 0">If the car hit scenery during the test the numbers are affected — rerun in an open street.</div>';
    }
    setKeys(phases[0].keys); requestAnimationFrame(t => { last = t; step(t); });
  };

  /* ---------- report export ---------- */
  function fullReport() { refreshEnv(); report.generated = new Date().toISOString(); return JSON.stringify(report, null, 2); }
  $('vpDl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([fullReport()], { type: 'application/json' })); a.download = 'supra_verification_report.json'; a.click(); };
  $('vpCopy').onclick = () => { navigator.clipboard.writeText(fullReport()).then(() => alert('Report copied'), () => alert('Copy failed; use Download')); };

  // Auto-run the geometry self-tests once the model is ready when opened with ?verify=1
  if (/[?&]verify=1/.test(location.search)) {
    const iv = setInterval(() => { if (J.P.modelState === 'loaded') { clearInterval(iv); buildMatList(); runTests(false); } else if (J.P.modelState === 'fallback') { clearInterval(iv); refreshEnv(); } }, 400);
  }
})();
