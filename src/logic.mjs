// APEX REVENGE game rules. DOM/Three.js free so it can be unit-tested and replayed deterministically.
export const CFG = Object.freeze({
  duration: 90, maxCrashes: 3,
  maxSpeed: 66, startSpeed: 28, minSpeed: 10, accel: 17, brake: 36, drag: 3.2, lateralMax: 13,
  roadHalf: 7.2, carW: 1.8, carL: 4.2, nearGap: 1.3, nearMinSpeed: 22, comboWindow: 3.0,
  spawnAhead: 250, tunnel: [1700, 2550], truckL: 7.2, squeezeFrom: 8, squeezeBonus: 500, rank: { S: 9000, A: 6000, B: 3500 }
});
export const LANE_X = Object.freeze([-5.4, -1.8, 1.8, 5.4]);
// Edge-to-edge gap (m) of a side-by-side pair. The player is carW = 1.8 m wide, so the clearance per side is (gap - 1.8) / 2.
export const SQUEEZE_GAPS = Object.freeze({ wide: 2.9, normal: 2.55, tight: 2.25 });
export const carLen = c => (c.kind === 'truck' ? CFG.truckL : CFG.carL);

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const inTunnel = s => s >= CFG.tunnel[0] && s <= CFG.tunnel[1];

export function createGame(seed = 1) {
  return { seed, rand: rng(seed), t: 0, s: 0, x: LANE_X[1], vx: 0, speed: CFG.startSpeed, cars: [], nextId: 1, nextWave: 140, freeLane: 1,
    lastWaveSqueeze: false, squeezes: 0, doubles: 0, score: 0, combo: 0, comboT: 0, mult: 1, maxCombo: 0, near: 0, passes: 0, crashes: 0, inv: 0, state: 'run', reason: '', events: [] };
}

// Traffic comes in waves: every wave leaves one lane free, and that free lane drifts by at most one lane
// between waves, so a route always exists. All cars share one slowly varying base speed so rows keep their shape.
const baseSpeed = g => 21 + 2 * Math.sin(g.t / 20);
function spawnSqueeze(g) {
  // two cars abreast on adjacent lanes, pushed apart so a precisely steered player fits between them.
  // The other two lanes stay open, so nobody is forced through the gap.
  const n = LANE_X.length, k = Math.floor(g.rand() * (n - 1));
  const tightP = 0.05 + 0.2 * Math.min(1, g.t / 60), r = g.rand();
  const kind = r < tightP ? 'tight' : r < tightP + 0.45 ? 'normal' : 'wide';
  const gap = SQUEEZE_GAPS[kind], mid = (LANE_X[k] + LANE_X[k + 1]) / 2, off = (gap + CFG.carW) / 2;
  const base = baseSpeed(g), s0 = g.nextWave, pair = g.nextId;
  for (const [i, x] of [[0, mid - off], [1, mid + off]]) {
    g.cars.push({ id: g.nextId++, lane: k + i, x, s: s0, speed: base, minGap: 99, passed: false, hit: false, nm: false,
      kind: 'car', hue: g.rand(), pair, squeeze: kind });
  }
  g.freeLane = k === 0 ? 3 : k === n - 2 ? 0 : (g.rand() < 0.5 ? 0 : 3);
  g.lastWaveSqueeze = true;
}
function spawnWave(g) {
  if (g.t >= CFG.squeezeFrom && !g.lastWaveSqueeze && g.rand() < 0.3) return spawnSqueeze(g);
  g.lastWaveSqueeze = false;
  const n = LANE_X.length;
  g.freeLane = Math.max(0, Math.min(n - 1, g.freeLane + Math.floor(g.rand() * 3) - 1));
  const fill = 0.5 + 0.4 * Math.min(1, g.t / 60);
  const base = baseSpeed(g);
  const s0 = g.nextWave;
  for (let lane = 0; lane < n; lane++) {
    if (lane === g.freeLane || g.rand() > fill) continue;
    g.cars.push({ id: g.nextId++, lane, x: LANE_X[lane], s: s0 + (g.rand() - 0.5) * 6, speed: base,
      minGap: 99, passed: false, hit: false, nm: false, kind: g.rand() < 0.2 ? 'truck' : 'car', hue: g.rand() });
  }
}

export function step(g, input, dt) {
  if (g.state !== 'run') return g;
  const { steer = 0, throttle = 0, brake = 0 } = input;
  g.t += dt;
  // longitudinal
  let a = CFG.accel * throttle * (1 - 0.7 * g.speed / CFG.maxSpeed) - CFG.brake * brake;
  if (!throttle && !brake) a -= CFG.drag;
  g.speed = Math.min(CFG.maxSpeed, Math.max(CFG.minSpeed, g.speed + a * dt));
  g.s += g.speed * dt;
  // lateral
  const target = Math.max(-1, Math.min(1, steer)) * CFG.lateralMax * (0.55 + 0.45 * Math.min(1, g.speed / 30));
  g.vx += (target - g.vx) * Math.min(1, dt * 9);
  g.x += g.vx * dt;
  const lim = CFG.roadHalf - 0.9;
  if (Math.abs(g.x) > lim) { g.x = Math.sign(g.x) * lim; g.vx = 0; g.speed = Math.max(CFG.minSpeed, g.speed - 12 * dt); }
  // traffic
  while (g.nextWave <= g.s + CFG.spawnAhead) { spawnWave(g); g.nextWave += (70 - 25 * Math.min(1, g.t / 60)) * (0.85 + 0.3 * g.rand()); }
  g.inv = Math.max(0, g.inv - dt);
  for (const c of g.cars) {
    c.s += c.speed * dt;
    const ds = c.s - g.s, dx = c.x - g.x, half = (CFG.carL + carLen(c)) / 2;   // hit box == drawn body
    if (Math.abs(ds) < half && Math.abs(dx) < CFG.carW && !c.hit && g.inv <= 0) {
      c.hit = true; g.crashes++; g.combo = 0; g.mult = 1; g.comboT = 0; g.inv = 1.4;
      g.speed = Math.max(CFG.minSpeed, Math.min(g.speed, c.speed) * 0.75);
      g.vx = (g.x >= c.x ? 1 : -1) * 6;
      g.events.push({ type: 'crash', id: c.id });
    } else if (!c.hit && Math.abs(ds) < half + 1.5) c.minGap = Math.min(c.minGap, Math.abs(dx) - CFG.carW);
    if (!c.passed && ds < -(half + 0.3)) {
      c.passed = true;
      if (!c.hit && c.minGap < CFG.nearGap && g.speed > CFG.nearMinSpeed) {
        const closeness = Math.max(0, 1 - Math.max(0, c.minGap) / CFG.nearGap);
        g.combo++; g.comboT = CFG.comboWindow; g.maxCombo = Math.max(g.maxCombo, g.combo);
        g.mult = Math.min(6, 1 + g.combo * 0.5);
        const pts = Math.round(100 * (1 + closeness * 1.5) * g.mult * (g.speed / 45));
        g.score += pts; g.near++; c.nm = true; c.closeness = closeness;
        g.events.push({ type: 'near', pts, combo: g.combo, mult: g.mult, gap: c.minGap, id: c.id, side: Math.sign(c.x - g.x) || 1 });
        // DOUBLE NEAR MISS: both cars of a side-by-side pair cleared closely from between them
        const mate = c.pair ? g.cars.find(o => o.pair === c.pair && o.id !== c.id) : null;
        if (mate && mate.nm && Math.sign(mate.x - g.x) !== Math.sign(c.x - g.x)) {
          g.combo += 1; g.comboT = CFG.comboWindow; g.maxCombo = Math.max(g.maxCombo, g.combo); g.mult = Math.min(6, 1 + g.combo * 0.5);
          const close = (closeness + (mate.closeness ?? 0)) / 2;
          const bonus = Math.round(CFG.squeezeBonus * (1 + close * 1.5) * g.mult * (g.speed / 45));
          g.score += bonus; g.doubles++;
          g.events.push({ type: 'double', pts: bonus, combo: g.combo, mult: g.mult, squeeze: c.squeeze, gap: Math.abs(c.x - mate.x) - CFG.carW });
        }
      } else if (!c.hit) { g.passes++; g.events.push({ type: 'pass', id: c.id }); }
    }
  }
  g.cars = g.cars.filter(c => c.s > g.s - 60 - (c.pair ? 10 : 0));
  if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) { g.combo = 0; g.mult = 1; g.events.push({ type: 'comboEnd' }); } }
  g.score += g.speed * dt * 0.5;
  if (g.crashes >= CFG.maxCrashes) { g.state = 'result'; g.reason = 'crash'; g.events.push({ type: 'end', reason: 'crash' }); }
  else if (g.t >= CFG.duration) { g.state = 'result'; g.reason = 'time'; g.events.push({ type: 'end', reason: 'time' }); }
  return g;
}

export function rankOf(score, reason = 'time') {
  const r = CFG.rank; const base = score >= r.S ? 'S' : score >= r.A ? 'A' : score >= r.B ? 'B' : 'C';
  return reason === 'crash' && base === 'S' ? 'A' : base;
}

// Simple autopilot used for automated play-throughs and screenshots (?bot=1).
export function botInput(g) {
  const lanes = LANE_X.map((lx, i) => {
    let d = 160;
    for (const c of g.cars) {
      const ds = c.s - g.s, back = (CFG.carL + carLen(c)) / 2 + 2;
      if (ds > -back && Math.abs(c.x - lx) < CFG.carW + 0.45 && ds < d) d = ds;
    }
    return d - Math.abs(lx - g.x) * 1.5 + (i === 1 || i === 2 ? 4 : 0);
  });
  let best = 0; lanes.forEach((v, i) => { if (v > lanes[best]) best = i; });
  const steer = Math.max(-1, Math.min(1, (LANE_X[best] - g.x) * 0.8));
  const front = Math.min(...g.cars.filter(c => c.s - g.s > 0 && Math.abs(c.x - g.x) < CFG.carW + 0.4).map(c => c.s - g.s - carLen(c) / 2), 999);
  return { steer, throttle: front < 22 ? 0 : 1, brake: front < 14 ? 1 : 0 };
}
