// APEX REVENGE game rules. DOM/Three.js free so it can be unit-tested and replayed deterministically.
export const CFG = Object.freeze({
  duration: 90, maxCrashes: 3,
  maxSpeed: 66, startSpeed: 28, minSpeed: 10, accel: 17, brake: 36, drag: 3.2, lateralMax: 13,
  roadHalf: 7.2, carW: 1.8, carL: 4.2, nearGap: 1.3, nearMinSpeed: 22, comboWindow: 3.0,
  spawnAhead: 250, tunnel: [1700, 2550], rank: { S: 9000, A: 6000, B: 3500 }
});
export const LANE_X = Object.freeze([-5.4, -1.8, 1.8, 5.4]);

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const inTunnel = s => s >= CFG.tunnel[0] && s <= CFG.tunnel[1];

export function createGame(seed = 1) {
  return { seed, rand: rng(seed), t: 0, s: 0, x: LANE_X[1], vx: 0, speed: CFG.startSpeed, cars: [], nextId: 1, nextWave: 140, freeLane: 1,
    score: 0, combo: 0, comboT: 0, mult: 1, maxCombo: 0, near: 0, passes: 0, crashes: 0, inv: 0, state: 'run', reason: '', events: [] };
}

// Traffic comes in waves: every wave leaves one lane free, and that free lane drifts by at most one lane
// between waves, so a route always exists. All cars share one slowly varying base speed so rows keep their shape.
function spawnWave(g) {
  const n = LANE_X.length;
  g.freeLane = Math.max(0, Math.min(n - 1, g.freeLane + Math.floor(g.rand() * 3) - 1));
  const fill = 0.5 + 0.4 * Math.min(1, g.t / 60);
  const base = 20 + 4 * Math.sin(g.t / 11);
  const s0 = g.nextWave;
  for (let lane = 0; lane < n; lane++) {
    if (lane === g.freeLane || g.rand() > fill) continue;
    g.cars.push({ id: g.nextId++, lane, x: LANE_X[lane], s: s0 + (g.rand() - 0.5) * 6, speed: base + (g.rand() - 0.5) * 1.6,
      minGap: 99, passed: false, hit: false, kind: g.rand() < 0.2 ? 'truck' : 'car', hue: g.rand() });
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
    const ds = c.s - g.s, dx = c.x - g.x;
    if (Math.abs(ds) < CFG.carL && Math.abs(dx) < CFG.carW && !c.hit && g.inv <= 0) {
      c.hit = true; g.crashes++; g.combo = 0; g.mult = 1; g.comboT = 0; g.inv = 1.4;
      g.speed = Math.max(CFG.minSpeed, Math.min(g.speed, c.speed) * 0.75);
      g.vx = (g.x >= c.x ? 1 : -1) * 6;
      g.events.push({ type: 'crash', id: c.id });
    } else if (!c.hit && Math.abs(ds) < 6) c.minGap = Math.min(c.minGap, Math.abs(dx) - CFG.carW);
    if (!c.passed && ds < -CFG.carL * 0.5 - 0.5) {
      c.passed = true;
      if (!c.hit && c.minGap < CFG.nearGap && g.speed > CFG.nearMinSpeed) {
        const closeness = Math.max(0, 1 - Math.max(0, c.minGap) / CFG.nearGap);
        g.combo++; g.comboT = CFG.comboWindow; g.maxCombo = Math.max(g.maxCombo, g.combo);
        g.mult = Math.min(6, 1 + g.combo * 0.5);
        const pts = Math.round(100 * (1 + closeness * 1.5) * g.mult * (g.speed / 45));
        g.score += pts; g.near++;
        g.events.push({ type: 'near', pts, combo: g.combo, mult: g.mult, gap: c.minGap, id: c.id, side: Math.sign(c.x - g.x) || 1 });
      } else if (!c.hit) { g.passes++; g.events.push({ type: 'pass', id: c.id }); }
    }
  }
  g.cars = g.cars.filter(c => c.s > g.s - 60);
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
  const clear = LANE_X.map((lx, i) => {
    let d = 140;
    for (const c of g.cars) { const ds = c.s - g.s; if (ds > -5 && Math.abs(c.x - lx) < 2.4 && ds < d) d = ds; }
    return d - Math.abs(lx - g.x) * 1.2 + (i === 1 || i === 2 ? 6 : 0);
  });
  let best = 0; clear.forEach((v, i) => { if (v > clear[best]) best = i; });
  const own = clear[LANE_X.reduce((b, _, i) => Math.abs(LANE_X[i] - g.x) < Math.abs(LANE_X[b] - g.x) ? i : b, 0)];
  const steer = Math.max(-1, Math.min(1, (LANE_X[best] - g.x) * 0.8));
  const front = Math.min(...g.cars.filter(c => c.s - g.s > 0 && Math.abs(c.x - g.x) < 2.2).map(c => c.s - g.s), 999);
  return { steer, throttle: front < 18 ? 0 : 1, brake: front < 14 && own < 25 ? 1 : 0 };
}
