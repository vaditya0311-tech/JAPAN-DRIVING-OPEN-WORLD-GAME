# Milestone 1.1 addendum — profile, multiplayer lobby, manual transmission, radio

## Offline checks completed
- `python tools/self_test.py`: passed all 10 original test groups.
- `node tools/test_supra_rig.js`: 18 PASS, 0 FAIL.
- Extracted the final inline JavaScript from `index.html`; `node --check` passed.
- Existing GLB and test assets were retained unchanged.

## Not verified in this environment
- Normal browser/WebGL rendering and menu flow were not executed, so please test the login/profile overlay, gearbox controls and radio panel in desktop Chrome.
- Multiplayer requires the PeerJS CDN and signalling infrastructure. Two-browser end-to-end connections, remote car alignment/latency, and cross-network behaviour were not verified here.
- The display-name profile is browser-local only; it is not account authentication.
- No licensed music files are distributed. The radio can play audio files selected by the user or open YouTube searches.
- Remote cars are lightweight proxy meshes, not full Supra GLB replicas; networked physics, collision authority and anti-cheat are outside this prototype.

Launch with `START_WINDOWS.bat` or `./start.sh`, then check `http://127.0.0.1:8000`. For multiplayer, use the same region in two separate browser sessions/devices, create a room in one, and join using its room code in the other.

---

# Test report — Milestone 1: baseline verification + Supra rig (Phase 0 + Phase 2)

**Read this first.** This environment has **no network and no Three.js**, so the game itself could **not be run or rendered here**.
Nothing below claims a visual, WebGL, audio, performance or in-game physics result. What *was* verified is the rig/camera **logic**,
executed for real against the **real GLB geometry** through a small Three.js-compatible scene-graph shim (`tools/three_shim.js`).
Everything marked UNVERIFIED needs a normal desktop-Chrome session — the in-game verification panel (F9) is built to do that in ~2 minutes.

## PASSED — verified here (offline, real asset)
| # | Check | How |
|---|---|---|
| 1 | Model size 4.370 × 1.994 × 1.256 m, grounded at y=0, centred (G1, G2) | `node tools/test_supra_rig.js` |
| 2 | +Z is the front: lamps ahead, tail lamps/plate behind (O1) | same |
| 3 | 4 wheels found by material; radius 0.325, hub height = radius, wheelbase 2.460, tracks 1.569/1.594, L/R symmetric (W1–W3) | same |
| 4 | Hub pivots are the true tyre centres: outer radius uniform 0.3250 about the axle, lowest point at road level (W4) | same |
| 5 | Rolling: +spin moves the tyre top forward, about the axle; hub fixed (W5) | same |
| 6 | Steering left turns front wheels toward car-left; rear do not steer; Ackermann inner > outer (W6, W6b) | same |
| 7 | Steer and spin are independent (W7) | same |
| 8 | 4 calipers found; front calipers steer, none spin (W8) | same |
| 9 | Body pitch/roll leaves wheels on the ground (B1) | same |
| 10 | Steering wheel: 35,304 triangles split out of 5 meshes, rotates about the column axis, left = counter-clockwise (S1–S3) | same + independent Python reimplementation gives the identical per-mesh counts |
| 11 | Cockpit eye: 12.7 cm headroom, 12.0 cm to headrest, 43 cm to seat, 29.5 cm to door, 84.8 cm to windshield (E1); hood cam 12.4 cm above bonnet (H1) | ray-cast against all 1.44 M triangles |
| 12 | The tests can fail: 8 deliberate mutations (spin/steer sign flipped, rear steering, hub 2 cm off, no sprung/unsprung split, steering-wheel sign flipped, eye 12 cm forward, calipers not rigged) each failed the expected check; the **old** cockpit eye position fails E1 (0.27 m to the windshield, 0.17 m of seat) | mutation runs |
| 13 | Syntax of `index.html` inline script, `supra_rig.js`, `verify_panel.js`; `tools/self_test.py` passes; `python http.server` serves all files (HTTP 200) | `node --check`, curl |
| 14 | Headless Chromium loads the page and `supra_rig.js`; page stops at `THREE is not defined` only because the CDN is blocked here | playwright |
| 15 | Original GLB untouched: SHA-256 identical to the upload (`895f91ed…9cd5`) | sha256sum |
| 16 | No BMW asset/code dependency exists in the project (none was supplied) | grep/find |

Reference images: 9 uploaded, **2 unique** (8 byte-identical coastal-town/expressway aerials + 1 hairpin forest road). Used only as inspiration for later phases.

## Defects found in the previous Supra code and fixed (static analysis against measured geometry)
Visual steering fixed at 0.45 rad vs the physics' speed-sensitive angle · front calipers never steered · pitch/roll applied to the whole model incl. wheels
(tyres into road when braking) · rear wheels jumped on handbrake release · cockpit eye ≈ inside the wheel/dash (z +0.02 vs wheel centre z −0.004) ·
cockpit camera Euler used default `XYZ` order (pitch became roll when heading ≠ 0) · hood camera on the bonnet surface · brake lights only worked with headlights on ·
fake 2D CSS dash drawn over the real interior · camera shake inside the cabin.

## FAILED
None known. (One of my own checks was initially too loose — the headrest-gap tolerance — and was tightened after a mutation slipped through.)

## UNVERIFIED — needs you in desktop Chrome (all of these are in the panel)
| Item | Why unverified here | How to check |
|---|---|---|
| Game starts without console errors | No Three.js/CDN offline | Open the page, F12 → Console |
| r128 `GLTFLoader` produces the structure the rig assumes (tyre meshes inside a Group, material names preserved) | Shim mirrors the GLB, not the loader | Panel header says `rig: OK`; otherwise it prints the reason |
| Wheels look right: roll, steer, calipers, no detached parts | No rendering | Panel → *Wheel sweep* + *Rig markers* + *Hide body* |
| Steering wheel split looks clean (no torn dash, no missing pad) | Selection is geometric, not seen | Cockpit view, steer; if wrong, tell me which part |
| Cockpit view: dash, wheel, windshield framing; no clipping at the near plane | No rendering | Press `2`/panel → Cockpit |
| `KHR_materials_clearcoat` applied by r128 (check `M-CC` and the MATERIALS list) | Needs the real loader | Panel → Run self-tests |
| Paint look: game-tuned vs GLB original | Needs a real render | Panel → *Paint* toggle |
| Rolling distance matches road distance, steering signs in motion, brake/reverse | Needs the running game | Panel → *Drive test (10 s)* |
| Performance (rig build ≈ 0.33 s in Node; browser unknown) | — | Check FPS overlay before/after |
| Shim fidelity | Shim re-implements Three.js maths (same formulas as r128) | Panel self-tests run the same code on real Three.js |

## Limitations / honest notes
- Physics, gears/RPM, audio, camera settings, world map: **not started** (next milestones). Gear/RPM are still the old arcade values.
- The steering-wheel rig is **experimental**: default ON. If it looks wrong, load the page with `?nosw=1` (wheel stays static, everything else unchanged) and tell me which part is wrong. A failure inside the split can no longer disable the wheel rig (it logs and continues).
- Visual body roll/pitch is scaled down (×0.35/×0.4, clamped to ±2°/±1.4°) so tyres never reach the arches; this changes the look, not the physics.


---

# (Previous report, before this milestone) Test report — milestone 0.5 (Toyota Supra scale, collision footprint and cameras)

## Passed checks

- **Supra geometry measurement:** Independent offline scene-graph inspection of the original GLB reported raw scene extents X=1.99379141 m, Y=1.25646323 m, Z=4.36951660 m. From these, the code's uniform scale is expected to be `4.370 / 4.369516598 ≈ 1.00011063`, maintaining proportions. This is a measurement/formula check, not a claim that the browser-side runtime assertion has executed successfully.

- **Inline JavaScript syntax:** Extracted the final inline game script from `index.html` and ran `node --check /tmp/jdu_inline_final.js` successfully (current extracted script: 151,664 bytes). The application remains one HTML entry point with ten inline/external script blocks.
- **Python syntax:** `python -m py_compile tools/download_japan_region.py tools/download_gsi_elevation.py tools/self_test.py` passed.
- **Offline project self-tests:** `python tools/self_test.py` passed all ten reported groups: coordinate projection, segment/polyline clipping, in-region footprint filtering, project integration points, GLB header/metadata and embedded image checks, Toyota loader wiring, uniform scale/ground centering, dimension-based collision footprint, wheel radius and camera markers, load-state handling, and graphics/diagnostics markers.
- **Utility CLI smoke tests:** `python tools/download_japan_region.py --help` and `python tools/download_gsi_elevation.py --help` both completed successfully without network access.
- **Exact model bytes:** Source upload and bundled `assets/vehicles/toyota_supra.glb` are both 56,835,680 bytes and have matching SHA-256: `895f91edbb14806935cb82213d07abf461e83de068c3152e8ec1909a6def9cd5`.
- **GLB structural inspection:** Header magic `glTF`, version 2, and declared file length match. JSON metadata reports 155 nodes, 87 meshes, 19 source materials, 4 embedded images, 0 animation clips, and 0 skins/skeletons. `trimesh` reports approximately 1.994 m width × 1.256 m height × 4.370 m length, Y-up and +Z-forward.
- **HTTP delivery:** In the final worktree, an active local Python HTTP server returned HTTP 200 for `http://127.0.0.1:8000/` (180,104 HTML bytes) and HTTP 200 for `http://127.0.0.1:8000/assets/vehicles/toyota_supra.glb` (56,835,680 bytes). This verifies local HTTP delivery only, not browser-side GLB decoding or rendering.

## Browser / WebGL tests not completed

- A Playwright/headless Chromium navigation attempt to `http://127.0.0.1:8000/` and `http://localhost:8765/` failed before document load with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. A separate headless Chromium attempt also emitted graphics/EGL context initialization errors.
- Therefore **actual WebGL model loading, texture appearance, car-ground contact, wheel pivot/spin/steering axes, cockpit eye position, camera clipping, headlamp appearance, controls, live adaptive-quality response, and real FPS/frame-time values are not verified**. The code and diagnostics are present, but no runtime success or FPS number is claimed here.
- The GLB has been structurally inspected and served over HTTP, but this is not proof that the pinned Three.js r128 GLTFLoader renders every material extension correctly. The asset declares `KHR_materials_specular`, `KHR_materials_clearcoat`, and `KHR_materials_emissive_strength`; compatibility needs a normal browser/WebGL check with the exact pinned loader.

## Network-backed map data not verified

- No OpenStreetMap regional JSON or GSI elevation grid is bundled. The earlier download attempt could not resolve the external Overpass host in this environment. The optional importers' CLI help and Python syntax passed, but live downloads, decoding and generated-map rendering were not tested.
- Current README instructions explain how to generate a small regional tile locally. Do not load the multi-gigabyte Japan-wide extract as one browser scene; use regional preprocessing and streaming.

## Current known limitations

- The GLB’s wheel groups are identified by geometric bounds because node names are generic. Bounds and pivots are now computed in the detached adapter’s local coordinate system; visual correctness remains unverified. The source has no animation clips and no safely identified semantic steering-wheel pivot, so the actual steering wheel mesh is not guessed or animated; the independent cockpit steering indicator remains reactive. The cockpit eye offset is estimated from a compact interior mesh on +X and still needs rendered confirmation.
- The reflection cubemap is procedural, not a captured HDRI. It provides environment highlights but is not equivalent to a real studio/sky environment map.
- The environment remains a procedural Hakone-inspired slice with optional OSM/GSI region import, not a complete detailed simulation of Japan. The current time/weather and traffic/handling systems remain prototype-level.
- No device/profile benchmark was possible in the browser-blocked environment. Targets such as 60 FPS are not represented as achieved results.

## Reproduction commands

Run from the project root:

```bash
python tools/self_test.py
python -m py_compile tools/download_japan_region.py tools/download_gsi_elevation.py tools/self_test.py
python tools/download_japan_region.py --help
python tools/download_gsi_elevation.py --help
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/` in a normal desktop Chrome/Chromium session with network access for the pinned Three.js r128 CDN scripts. Use `F3` or `~` for the in-game diagnostics overlay and check the model status/console before treating the model integration as browser-validated.

## Recheck for the latest user upload (2026-10-16)

- Compared the newly uploaded `toyota_supra(1).glb` with `assets/vehicles/toyota_supra.glb` in this package. Both are 56,835,680 bytes and have identical SHA-256 `895f91edbb14806935cb82213d07abf461e83de068c3152e8ec1909a6def9cd5`.
- Re-ran `python tools/self_test.py`: all ten reported test groups passed.
- Re-extracted the inline script from `index.html`; `node --check` passed.
- Re-ran Python compilation for both regional data tools and `tools/self_test.py`, plus both utility `--help` commands: passed.
- These are static and asset-integrity checks; they do not replace a real desktop browser/WebGL gameplay check.


## Latest recheck — map expansion / host loader (2026-10-16)

- `python tools/self_test.py`: passed (all reported groups).
- `node tools/test_supra_rig.js`: **18 PASS, 0 FAIL**.
- Extracted inline JavaScript: `node --check` passed. HTML id scan reported no duplicates.
- Static source scan confirms rural-zone geometry, gable-roof instancing, crop-row plots and compressed-model manifest loader are present.
- Gzip-compressed Toyota GLB segments for the web package were reassembled/decompressed and byte-checked against the original source model.
- Network request for a regional OSM tile timed out; actual geographic map data is not bundled. Live rendering and the final hosted URL are not verified: browser rendering is unavailable here and the hosting upload must be completed by the project owner.


# Latest verification — Milestone 1.3 (2026-10-16)

## Passed

- `python tools/self_test.py`: all reported groups passed, including map projection, polygon/footprint logic, project integration markers, GLB metadata and loader/rig markers.
- `node tools/test_supra_rig.js`: **18 PASS, 0 FAIL**; wheel size/hubs, steering geometry, rolling, calipers, body split, cockpit and hood anchors.
- `node tools/test_architecture_mesh.js`: passed finite city/village geometry and aligned UV/color attribute checks.
- `python tools/test_phase2_features.py`: **15/15 PASS**; verifies the procedural Andhra zone, lofted architectural mesher, stepped silhouettes, instanced facade features, village roads/fields/palms, roundabouts, field non-collision, live-cluster wiring, map destinations, unique DOM IDs and byte-identical Supra model.
- Extracted all inline `<script>` content and `node --check` passed.
- The original GLB hash matches the received asset exactly: `895f91edbb14806935cb82213d07abf461e83de068c3152e8ec1909a6def9cd5`.

## Not verified in browser

- A headless Chromium attempt against the local server did not complete successfully while loading the browser/CDN-dependent game. Consequently the actual WebGL scene, the cluster display's visual alignment/UV direction, runtime FPS and gameplay appearance must still be checked in normal desktop Chrome/Edge with internet access.
- No new real-world map tile could be downloaded in this environment. Andhra village and city architecture are generated game geometry, not verified real place data.
- No public host deployment was performed; upload the included web-deploy ZIP to a static host to receive a live URL.
