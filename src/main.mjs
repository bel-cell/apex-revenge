import * as THREE from 'three';
import { CFG, LANE_X, createGame, step, rankOf, botInput, inTunnel } from './logic.mjs';
import { createAudio } from './audio.mjs';
import { TiltController, SENSITIVITY } from './tilt.mjs';

const Q = new URLSearchParams(location.search);
const BOT = Q.get('bot') === '1';
const isTouch = Q.get('touch') === '1' || matchMedia('(pointer: coarse)').matches;
const $ = id => document.getElementById(id);
if (isTouch) document.body.classList.add('is-touch');
if (Q.get('fps') === '1') $('fps').hidden = false;

// ------------------------------------------------------------------ renderer / scene
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let maxRatio = Math.min(window.devicePixelRatio || 1, isTouch ? 1.25 : 1.5), ratio = Number(Q.get('ratio')) || maxRatio;
const CITY_FOG = new THREE.Color(0x0b1030), TUNNEL_FOG = new THREE.Color(0x2a1506);
const scene = new THREE.Scene();
scene.background = CITY_FOG.clone();
scene.fog = new THREE.Fog(CITY_FOG.clone(), 40, 340);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 700);
scene.add(camera);
const ambient = new THREE.AmbientLight(0x4a5c9a, 1.5); scene.add(ambient);
const sun = new THREE.DirectionalLight(0x9fb4ff, 1.1); sun.position.set(-4, 8, 6); scene.add(sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(ratio); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  $('rotate').hidden = !(isTouch && h > w);
}
window.addEventListener('resize', resize);
// Safari's toolbar collapses/expands and changes the visual viewport without a window resize event.
window.visualViewport?.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();
const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
document.body.classList.toggle('standalone', standalone);
(function a2hs() {
  let dismissed = false; try { dismissed = localStorage.getItem('apex.a2hs') === '1'; } catch {}
  const el = document.getElementById('a2hs');
  if (isTouch && isIOS && !standalone && !dismissed) el.hidden = false;
  document.getElementById('a2hs-close').addEventListener('click', () => { el.hidden = true; try { localStorage.setItem('apex.a2hs', '1'); } catch {} });
})();

const hash = (a, b = 0) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const glowTex = canvasTex(64, 64, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const additive = (map, color = 0xffffff, opacity = 1) => new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

// ------------------------------------------------------------------ road + barriers
const ROAD_W = 16.4, ROAD_LEN = 440;
const roadTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#17181f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${40 + Math.random() * 40 | 0},${40 + Math.random() * 40 | 0},${50 + Math.random() * 40 | 0},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  const X = m => (m + ROAD_W / 2) / ROAD_W * w;
  g.fillStyle = '#e8ecff'; for (const m of [-7.2, 7.2]) g.fillRect(X(m) - 3, 0, 6, h);
  g.fillStyle = '#d9deef'; for (const m of [-3.6, 0, 3.6]) for (const y0 of [0, 256]) g.fillRect(X(m) - 2.5, y0, 5, 128);
  g.fillStyle = 'rgba(255,170,80,0.10)'; g.fillRect(0, 0, w, 6);
}, { repeat: [1, ROAD_LEN / 16] });
const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshBasicMaterial({ map: roadTex }));
road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -ROAD_LEN / 2 + 40); scene.add(road);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, ROAD_LEN), new THREE.MeshBasicMaterial({ color: 0x04050c }));
ground.rotation.x = -Math.PI / 2; ground.position.set(0, -14, -ROAD_LEN / 2 + 40); scene.add(ground);
const railTex = canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = '#12131a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#4a4f66'; g.fillRect(0, 10, w, 26); g.fillStyle = '#2a2d3d'; g.fillRect(0, 36, w, 6);
  g.fillStyle = '#ffb347'; g.fillRect(w / 2 - 4, 16, 8, 8); g.fillStyle = '#12131a'; g.fillRect(0, 0, 6, h);
}, { repeat: [ROAD_LEN / 4, 1] });
const rails = [];
for (const side of [-1, 1]) {
  const r = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_LEN, 1.1), new THREE.MeshBasicMaterial({ map: railTex, side: THREE.DoubleSide }));
  r.rotation.y = Math.PI / 2; r.position.set(side * 8.3, 0.55, -ROAD_LEN / 2 + 40); scene.add(r); rails.push(r);
}

// ------------------------------------------------------------------ city (instanced)
const SP = 26, NB = 24;
const winTex = canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = '#10131f'; g.fillRect(0, 0, w, h);
  for (let y = 4; y < h - 4; y += 8) for (let x = 4; x < w - 4; x += 8) {
    const r = Math.random(); if (r < 0.45) continue;
    g.fillStyle = r < 0.8 ? '#ffd98a' : r < 0.93 ? '#9fe8ff' : '#ff9ad5'; g.fillRect(x, y, 4, 5);
  }
});
const bGeom = new THREE.BoxGeometry(1, 1, 1); bGeom.translate(0, 0.5, 0);
const bMat = new THREE.MeshBasicMaterial({ map: winTex });
const bCount = NB * 2 * 2;
const buildings = new THREE.InstancedMesh(bGeom, bMat, bCount); buildings.frustumCulled = false; scene.add(buildings);
buildings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bCount * 3), 3);
const NS = 60;
const signMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const signs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 1), signMat, NS); signs.frustumCulled = false; scene.add(signs);
signs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NS * 3), 3);
const NEON = [0xff3fd0, 0x3ff0ff, 0xffb02e, 0x7dff6a, 0xff4a4a];

// ------------------------------------------------------------------ lamps
const NL = 30, LSP = 34;
const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 9, 0.22), new THREE.MeshBasicMaterial({ color: 0x2b2f42 }), NL * 2); poles.frustumCulled = false; scene.add(poles);
const heads = new THREE.InstancedMesh(new THREE.PlaneGeometry(9, 9), additive(glowTex, 0xffa24a, 0.95), NL * 2); heads.frustumCulled = false; scene.add(heads);
const poolGeom = new THREE.PlaneGeometry(9, 20); poolGeom.rotateX(-Math.PI / 2);
const pools = new THREE.InstancedMesh(poolGeom, additive(glowTex, 0xff9a3a, 0.45), NL * 2); pools.frustumCulled = false; scene.add(pools);

// ------------------------------------------------------------------ tunnel
const [T0, T1] = CFG.tunnel, TLEN = T1 - T0;
const tunnel = new THREE.Group(); scene.add(tunnel);
const wallTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#2b2118'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#3a2d20'; g.fillRect(0, 0, w, 6); g.fillRect(w - 3, 0, 3, h);
  g.fillStyle = '#ffcf6a'; g.fillRect(0, 70, w, 4);                 // emergency light strip
  g.fillStyle = '#7dff9a'; g.fillRect(0, 84, w, 2);
  const r = g.createRadialGradient(w / 2, 30, 0, w / 2, 30, 50); r.addColorStop(0, 'rgba(255,200,110,.9)'); r.addColorStop(1, 'rgba(255,200,110,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
}, { repeat: [TLEN / 10, 1] });
const ceilTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#17120d'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffe6a8'; g.fillRect(w * 0.22, 0, 7, h); g.fillRect(w * 0.78 - 7, 0, 7, h);
  g.fillStyle = '#ffb347'; g.fillRect(0, h / 2 - 5, w, 10);
}, { repeat: [1, TLEN / 10] });
for (const side of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(TLEN, 6), new THREE.MeshBasicMaterial({ map: wallTex }));
  w.rotation.y = -side * Math.PI / 2; w.position.set(side * 8.4, 3, -TLEN / 2); tunnel.add(w);
}
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(16.8, TLEN), new THREE.MeshBasicMaterial({ map: ceilTex }));
ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 6, -TLEN / 2); tunnel.add(ceil);
const hill = new THREE.MeshBasicMaterial({ color: 0x090b14 });
const hillIn = new THREE.Mesh(new THREE.BoxGeometry(120, 40, 30), hill); hillIn.position.set(0, 26, 15); tunnel.add(hillIn);
const hillOut = new THREE.Mesh(new THREE.BoxGeometry(120, 40, 30), hill); hillOut.position.set(0, 26, -TLEN - 15); tunnel.add(hillOut);
const portalLight = new THREE.Mesh(new THREE.PlaneGeometry(17, 6.4), new THREE.MeshBasicMaterial({ color: 0xfff1d0, fog: false })); portalLight.position.set(0, 3.2, -TLEN - 0.5); tunnel.add(portalLight);
const exitGlow = new THREE.Mesh(new THREE.PlaneGeometry(40, 18), additive(glowTex, 0xffe0a0, 0.9)); exitGlow.position.set(0, 3.5, -TLEN - 0.6); tunnel.add(exitGlow);

// ------------------------------------------------------------------ skyline glow (attached to camera)
const skyTex = canvasTex(16, 128, (g, w, h) => {
  const r = g.createLinearGradient(0, h, 0, 0);
  r.addColorStop(0, 'rgba(255,90,170,0.95)'); r.addColorStop(0.35, 'rgba(120,70,255,0.45)'); r.addColorStop(1, 'rgba(10,20,80,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});
const sky = new THREE.Mesh(new THREE.PlaneGeometry(1100, 220), additive(skyTex, 0xffffff, 0.55)); sky.position.set(0, 35, -420); camera.add(sky);

// ------------------------------------------------------------------ cars
const tailGeom = new THREE.BoxGeometry(0.42, 0.18, 0.08);
const glowGeom = new THREE.PlaneGeometry(2.2, 2.2);
function makeCar(kind, hue, player = false) {
  const g = new THREE.Group();
  const col = player ? new THREE.Color(0x2c5dff) : new THREE.Color().setHSL(hue, 0.45, 0.2);
  const mat = new THREE.MeshLambertMaterial({ color: col });
  const L = kind === 'truck' ? 7.2 : 4.2, Hh = kind === 'truck' ? 2.6 : 0.8;
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, Hh, L), mat); body.position.y = 0.35 + Hh / 2; g.add(body);
  if (kind !== 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 2.1), new THREE.MeshLambertMaterial({ color: 0x0a0d18 })); cab.position.set(0, 1.55, 0.15); g.add(cab);
  }
  const tail = new THREE.MeshBasicMaterial({ color: player ? 0xff2a2a : 0xff1c1c });
  const ty = kind === 'truck' ? 1.0 : 0.95;
  for (const sx of [-0.62, 0.62]) { const t = new THREE.Mesh(tailGeom, tail); t.position.set(sx, ty, L / 2 + 0.02); g.add(t); }
  const gl = new THREE.Mesh(glowGeom, additive(glowTex, 0xff2020, player ? 0.7 : 0.55)); gl.position.set(0, ty, L / 2 + 0.3); g.add(gl);
  g.userData = { glow: gl, tail };
  return g;
}
const traffic = new Map();           // id -> mesh
const carPool = [];
const player = makeCar('car', 0, true); scene.add(player);
const beamMat = additive(glowTex, 0xcfe0ff, 0.28);
for (const sx of [-0.6, 0.6]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 38), beamMat); b.rotation.x = -Math.PI / 2; b.position.set(sx, 0.05, -20); player.add(b); }

// speed lines
const NLN = 70, linePos = new Float32Array(NLN * 6), lineSeed = [];
for (let i = 0; i < NLN; i++) { const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 9; lineSeed.push({ x: Math.cos(a) * r, y: 0.2 + Math.abs(Math.sin(a)) * r * 0.55, z: -Math.random() * 90 }); }
const lineGeom = new THREE.BufferGeometry(); lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
const lineMat = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const lines = new THREE.LineSegments(lineGeom, lineMat); lines.frustumCulled = false; scene.add(lines);

// ------------------------------------------------------------------ world update (everything is positioned relative to the player's distance s)
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
function updateWorld(g, tAmt) {
  const s = g.s;
  roadTex.offset.y = (s / 16) % 1;
  railTex.offset.x = (s / 4) % 1;
  tunnel.position.z = s - T0;
  const after = s > T1 - 100;
  let n = 0;
  for (const side of [-1, 1]) for (let row = 0; row < 2; row++) for (let i = 0; i < NB; i++) {
    const k = Math.floor(s / SP) + i - 4, sAbs = k * SP + row * 11, z = -(sAbs - s);
    const hid = sAbs > T0 - 6 && sAbs < T1 + 6;
    const hh = hash(k, side * 3 + row), hw = hash(k + 77, row), hd = hash(k + 31, side);
    const post = sAbs > T1;
    const H = hid ? 0.001 : (post ? 30 + hh * 110 : 12 + hh * 55) + (row ? 25 : 0);
    const w = 9 + hw * 14, d = 10 + hd * 12, x = side * (13 + row * 20 + w / 2 + hash(k, 9) * 6);
    dummy.position.set(x, -18, z); dummy.scale.set(w, H + 18, d); dummy.updateMatrix(); buildings.setMatrixAt(n, dummy.matrix);
    const b = post ? 1.35 : 0.85;
    tmpC.setRGB(b * (0.7 + hw * 0.5), b * (0.75 + hh * 0.45), b * (0.9 + hd * 0.4)); buildings.setColorAt(n, tmpC);
    n++;
  }
  buildings.instanceMatrix.needsUpdate = true; buildings.instanceColor.needsUpdate = true;
  for (let i = 0; i < NS; i++) {
    const k = Math.floor(s / 40) + i - 2, sAbs = k * 40 + 7, z = -(sAbs - s), side = hash(k, 5) < 0.5 ? -1 : 1;
    const hid = (sAbs > T0 - 6 && sAbs < T1 + 6) || hash(k, 8) < 0.35;
    dummy.position.set(side * (11.5 + hash(k, 2) * 4), 4 + hash(k, 3) * 24, z);
    dummy.scale.set(1, hid ? 0.001 : 2 + hash(k, 4) * 5, hid ? 0.001 : 3 + hash(k, 6) * 7); dummy.updateMatrix(); signs.setMatrixAt(i, dummy.matrix);
    tmpC.setHex(NEON[Math.floor(hash(k, 1) * NEON.length)]); signs.setColorAt(i, tmpC);
  }
  signs.instanceMatrix.needsUpdate = true; signs.instanceColor.needsUpdate = true;
  n = 0;
  for (const side of [-1, 1]) for (let i = 0; i < NL; i++) {
    const k = Math.floor(s / LSP) + i - 2, sAbs = k * LSP, z = -(sAbs - s), hid = sAbs > T0 - 4 && sAbs < T1 + 4;
    const sc = hid ? 0.001 : 1;
    dummy.position.set(side * 8.9, 4.5, z); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); poles.setMatrixAt(n, dummy.matrix);
    dummy.position.set(side * 7.4, 9.2, z); dummy.scale.set(sc, sc, sc); dummy.updateMatrix(); heads.setMatrixAt(n, dummy.matrix);
    dummy.position.set(side * 4.6, 0.04, z); dummy.updateMatrix(); pools.setMatrixAt(n, dummy.matrix);
    n++;
  }
  poles.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = pools.instanceMatrix.needsUpdate = true;
  // traffic
  const alive = new Set();
  for (const c of g.cars) {
    alive.add(c.id);
    let m = traffic.get(c.id);
    if (!m) { m = carPool.pop() || makeCar(c.kind, c.hue); if (m.userData.kind !== c.kind || m.userData.hue !== c.hue) { m = makeCar(c.kind, c.hue); } m.userData.kind = c.kind; m.userData.hue = c.hue; scene.add(m); traffic.set(c.id, m); }
    m.position.set(c.x, 0, -(c.s - s)); m.visible = c.s - s > -30;
  }
  for (const [id, m] of traffic) if (!alive.has(id)) { scene.remove(m); traffic.delete(id); }
  // lamp light fades inside the tunnel, ambient goes warm
  ambient.color.setRGB(0.29 + 0.45 * tAmt, 0.36 + 0.12 * tAmt, 0.6 - 0.35 * tAmt);
  scene.fog.color.copy(CITY_FOG).lerp(TUNNEL_FOG, tAmt); scene.background.copy(scene.fog.color);
  scene.fog.far = 340 - 150 * tAmt;
  sky.material.opacity = (after ? 0.95 : 0.55) * (1 - 0.85 * tAmt);
}

// ------------------------------------------------------------------ input
const keys = new Set();
const pressed = { left: false, right: false, accel: false, brake: false };
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.code);
  if (e.repeat) return;
  if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) startGame();
  else if (mode === 'result' && ['Enter', 'KeyR', 'Space'].includes(e.code)) startGame();
  else if ((mode === 'run' || mode === 'paused') && (e.code === 'KeyP' || e.code === 'Escape')) togglePause();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); for (const k in pressed) pressed[k] = false; if (mode === 'run') togglePause(true); });
for (const [id, name] of [['t-left', 'left'], ['t-right', 'right'], ['t-accel', 'accel'], ['t-brake', 'brake']]) {
  const el = $(id);
  const set = v => e => { e.preventDefault(); pressed[name] = v; el.classList.toggle('down', v); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); set(true)(e); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, set(false));
  el.addEventListener('contextmenu', e => e.preventDefault());
}
const KEYMAP = { left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], accel: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'] };
const down = n => pressed[n] || KEYMAP[n].some(k => keys.has(k));
// Tilt steering feeds the SAME steer input as keys / touch buttons (it is not a lateral-position mapping).
let prefs = {}; try { prefs = JSON.parse(localStorage.getItem('apex.tilt') || '{}'); } catch {}
const tilt = new TiltController({ invert: prefs.invert, sens: Number.isInteger(prefs.sens) ? prefs.sens : 1, enabled: prefs.enabled ?? true });
const savePrefs = () => { try { localStorage.setItem('apex.tilt', JSON.stringify({ invert: tilt.invert, sens: tilt.sens, enabled: tilt.enabled })); } catch {} };
const tiltCapable = typeof window.DeviceOrientationEvent !== 'undefined';
if (!window.isSecureContext && isTouch) tilt.permission = 'unavailable';
else if (!tiltCapable) tilt.permission = 'unavailable';
addEventListener('deviceorientation', e => tilt.feed(e.beta, e.gamma, performance.now()));
async function askTilt() {
  if (!isTouch || !tilt.enabled || tilt.permission === 'unavailable') return;
  if (!tiltCapable) { tilt.permission = 'unavailable'; return; }
  try {
    const r = typeof DeviceOrientationEvent.requestPermission === 'function' ? await DeviceOrientationEvent.requestPermission() : 'granted';
    tilt.permission = r === 'granted' ? 'granted' : 'denied';
  } catch { tilt.permission = 'denied'; }
  if (tilt.permission === 'granted') tilt.recenter(performance.now());
  refreshTiltUI();
}
const tiltActive = () => isTouch && tilt.enabled && tilt.permission === 'granted';
function refreshTiltUI() {
  const now = performance.now();
  const st = !isTouch ? '' : !tilt.enabled ? '傾きハンドル: OFF（タッチで操作）'
    : tilt.permission === 'unavailable' ? '傾きセンサーが使えません（HTTPS接続が必要）。タッチで操作できます'
    : tilt.permission === 'denied' ? 'センサーの許可がありません。タッチで操作できます'
    : tilt.permission === 'granted' ? (tilt.active(now) ? '傾きハンドル: 有効' : '傾きを検出中… 端末を少し動かしてください') : '傾きハンドル: START時に許可を求めます';
  $('tilt-status').textContent = st;
  $('tilt-toggle').textContent = '傾きハンドル: ' + (tilt.enabled ? 'ON' : 'OFF');
  $('tilt-invert').textContent = '操舵方向: ' + (tilt.invert ? '反転' : '通常');
  $('tilt-sens').textContent = '感度: ' + SENSITIVITY[tilt.sens].label;
  document.body.classList.toggle('tilt-on', tiltActive());
}
function readInput(g) {
  if (BOT) return botInput(g);
  const ts = tilt.steer(performance.now());
  const steer = Math.max(-1, Math.min(1, (down('right') ? 1 : 0) - (down('left') ? 1 : 0) + ts));
  return { steer, throttle: down('accel') ? 1 : 0, brake: down('brake') ? 1 : 0 };
}

// ------------------------------------------------------------------ game flow / HUD
const audio = createAudio();
let mode = 'title', g = createGame(Number(Q.get('seed')) || 11), demo = true;
let shake = 0, popT = 0, wasTunnel = false, tAmt = 0, lastLife = -1, resultTimer = 0, lastInput = { throttle: 0 };
const fmt = n => Math.round(n).toLocaleString('en-US');

function startGame() {
  const ban = document.getElementById('a2hs'); if (ban) ban.hidden = true;
  if (isTouch && !isIOS && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  askTilt();                      // must run inside the user gesture (iOS)
  tilt.recenter(performance.now());   // current hold = neutral
  audio.start(); audio.startBgm();
  g = createGame(Number(Q.get('seed')) || (Date.now() % 100000)); demo = false; mode = 'run'; wasTunnel = false;
  for (const id of ['title', 'result', 'paused']) $(id).hidden = true;
  $('hud').hidden = false; $('touch').hidden = !isTouch; popT = 0; lastLife = -1;
}
function togglePause(forceOn) {
  if (mode === 'run') { mode = 'paused'; $('paused').hidden = false; audio.stopBgm(); }
  else if (mode === 'paused' && !forceOn) { mode = 'run'; $('paused').hidden = true; audio.startBgm(); last = performance.now(); tilt.recenter(last); }
}
function popText(text, cls = '') {
  const el = $('pop'); el.textContent = text; el.className = 'pop ' + cls; void el.offsetWidth; el.className = 'pop show ' + cls;
}
function showResult() {
  mode = 'result'; audio.stopBgm(); audio.end(); $('hud').hidden = true; $('touch').hidden = true;
  $('result-title').textContent = g.reason === 'crash' ? 'CRASHED' : 'FINISH';
  $('rank').textContent = rankOf(g.score, g.reason);
  $('r-score').textContent = fmt(g.score); $('r-near').textContent = g.near; $('r-combo').textContent = g.maxCombo;
  $('r-crash').textContent = g.crashes; $('r-dist').textContent = (g.s / 1000).toFixed(2) + ' km';
  $('result').hidden = false;
}
function handleEvents() {
  for (const e of g.events) {
    if (e.type === 'near') { popText(`NEAR MISS +${fmt(e.pts)}`); audio.near(e.combo, e.side); shake = Math.max(shake, 0.25); $('combo').textContent = `COMBO ×${e.mult.toFixed(1)}  (${e.combo})`; }
    else if (e.type === 'pass') audio.pass();
    else if (e.type === 'crash') { popText('CRASH!', 'crash'); audio.crash(); shake = 1; flash('#ff2a3a', 0.55); }
    else if (e.type === 'comboEnd') $('combo').classList.remove('on');
    else if (e.type === 'end') resultTimer = 0.9;
  }
  g.events.length = 0;
  $('combo').classList.toggle('on', g.combo > 0);
}
function flash(color, a) { const f = $('flash'); f.style.transition = 'none'; f.style.background = color; f.style.opacity = a; void f.offsetWidth; f.style.transition = 'opacity .7s ease-out'; f.style.opacity = 0; }
$('tilt-toggle').addEventListener('click', () => { tilt.enabled = !tilt.enabled; savePrefs(); if (tilt.enabled && tilt.permission !== 'granted') askTilt(); refreshTiltUI(); });
$('tilt-invert').addEventListener('click', () => { tilt.invert = !tilt.invert; savePrefs(); refreshTiltUI(); });
$('tilt-sens').addEventListener('click', () => { tilt.sens = (tilt.sens + 1) % SENSITIVITY.length; savePrefs(); refreshTiltUI(); });
for (const id of ['recenter', 'recenter2']) $(id).addEventListener('click', () => tilt.recenter(performance.now()));
addEventListener('keydown', e => { if (e.code === 'KeyC' && !e.repeat) tilt.recenter(performance.now()); });
for (const ev of ['orientationchange', 'resize']) addEventListener(ev, () => tilt.softReset(performance.now()));
setInterval(refreshTiltUI, 400); refreshTiltUI();
$('start').addEventListener('click', startGame); $('retry').addEventListener('click', startGame); $('resume').addEventListener('click', () => togglePause());
$('title').addEventListener('pointerdown', e => { if (!e.target.closest('button') && isTouch) startGame(); });
$('result').addEventListener('pointerdown', e => { if (!e.target.closest('button') && isTouch) startGame(); });

let hudCache = {};
function hud() {
  const set = (k, id, v) => { if (hudCache[k] !== v) { hudCache[k] = v; $(id).textContent = v; } };
  set('sc', 'score', fmt(g.score)); set('tm', 'time', Math.max(0, Math.ceil(CFG.duration - g.t))); set('sp', 'speed', Math.round(g.speed * 3.6));
  set('lf', 'life', '♥'.repeat(Math.max(0, CFG.maxCrashes - g.crashes)) + '♡'.repeat(Math.min(CFG.maxCrashes, g.crashes)));
}

// ------------------------------------------------------------------ main loop
let last = performance.now(), acc = 0, ema = 16.7, qTimer = 0, frames = 0, fpsT = performance.now(), fps = 0;
const tmpV = new THREE.Vector3();
function frame(now) {
  const dtMs = now - last, dt = Math.min(0.05, dtMs / 1000); last = now;
  ema += (dtMs - ema) * 0.05; frames++;
  if (now - fpsT > 500) { fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; if (!$('fps').hidden) $('fps').textContent = `${fps.toFixed(0)} fps  ${ema.toFixed(1)} ms  x${ratio.toFixed(2)}`; }
  const running = mode === 'run' || mode === 'title';
  if (running) {
    const input = mode === 'title' ? botInput(g) : readInput(g); lastInput = input;
    acc += dt;
    while (acc >= 1 / 60) { step(g, input, 1 / 60); acc -= 1 / 60; if (g.state !== 'run' && mode === 'title') { g = createGame(Math.floor(Math.random() * 999)); } }
    if (mode === 'run') { handleEvents(); hud(); }
    else g.events.length = 0;
    if (mode === 'run' && g.state !== 'run') { resultTimer -= dt; if (resultTimer <= 0) showResult(); }
  }
  const tun = inTunnel(g.s + 8);
  tAmt += ((tun ? 1 : 0) - tAmt) * Math.min(1, dt * 4);
  if (wasTunnel && !tun && mode === 'run') { flash('#fff4d6', 0.95); audio.tunnelExit(); popText('CITY LIGHTS'); shake = 0.3; }
  wasTunnel = tun;
  updateWorld(g, tAmt);
  // camera & player
  const k = g.speed / CFG.maxSpeed;
  shake = Math.max(0, shake - dt * 2.2);
  const sh = shake * 0.12 + k * 0.012;
  player.position.set(g.x, 0, 0);
  player.rotation.y = -g.vx * 0.012; player.rotation.z = -g.vx * 0.01;
  player.visible = g.inv <= 0 || Math.floor(now / 70) % 2 === 0;
  const braking = lastInput.brake > 0; player.userData.glow.material.opacity = braking ? 1.0 : 0.55;
  camera.position.set(g.x * 0.72 + (Math.random() - 0.5) * sh, 2.7 + (Math.random() - 0.5) * sh, 7.6 + k * 1.2);
  camera.lookAt(g.x * 0.85, 1.2, -28);
  camera.fov = 60 + k * 20 + (mode === 'run' && lastInput.throttle ? 3 : 0); camera.updateProjectionMatrix();
  // speed lines
  const arr = lineGeom.attributes.position.array, len = 2 + k * 14;
  for (let i = 0; i < NLN; i++) {
    const L = lineSeed[i]; L.z += g.speed * dt * 1.4; if (L.z > 6) { L.z = -90 - Math.random() * 20; }
    const o = i * 6; arr[o] = L.x + camera.position.x * 0.5; arr[o + 1] = L.y; arr[o + 2] = L.z; arr[o + 3] = arr[o]; arr[o + 4] = L.y; arr[o + 5] = L.z - len;
  }
  lineGeom.attributes.position.needsUpdate = true; lineMat.opacity = Math.max(0, (k - 0.35) * 1.1);
  audio.update({ speed: g.speed, throttle: lastInput.throttle || 0, tunnel: tun, running: mode === 'run' || mode === 'title' && false });
  // adaptive resolution
  qTimer += dt;
  if (qTimer > 1.5 && Q.get('ratio') == null) {
    qTimer = 0;
    if (ema > 21 && ratio > 0.55) { ratio = Math.max(0.55, ratio * 0.85); resize(); }
    else if (ema < 12.5 && ratio < maxRatio) { ratio = Math.min(maxRatio, ratio + 0.1); resize(); }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__apex = { tilt, tiltSteer: () => tilt.steer(performance.now()), tiltActive, state: () => g, mode: () => mode, fps: () => fps, frameMs: () => ema, ratio: () => ratio, start: startGame, calls: () => renderer.info.render.calls, tris: () => renderer.info.render.triangles };
