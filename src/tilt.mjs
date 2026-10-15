// Tilt steering. The math (gravity vector, landscape-grip detection, centre-relative tilt, dead zone, smoothing)
// is adapted from the tilt module of a separate local project (im-hero); re-implemented here.
// Everything here is DOM-free so it can be unit-tested; the DeviceOrientation listener lives in main.mjs.
export const FEEL = Object.freeze({ deadZone: 3, fullTilt: 24, smoothingMs: 70, sensorTimeoutMs: 600, rampMs: 450, gripHoldMs: 500 });
const rad = Math.PI / 180;
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const normalize = v => { const n = Math.hypot(...v); return n > 1e-8 ? v.map(x => x / n) : null; };

export function screenAngleFrom({ legacyAngle, modernAngle } = {}) {
  const a = Number.isFinite(legacyAngle) ? legacyAngle : Number.isFinite(modernAngle) ? modernAngle : 0;
  return ((a % 360) + 360) % 360;
}
// World-down expressed on the displayed screen axes. +x = displayed right edge is lower, +y = bottom edge is lower.
export function gravity(beta, gamma, screenAngle = 0) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const b = beta * rad, g = gamma * rad, s = screenAngle * rad;
  const x = -Math.cos(b) * Math.sin(g), y = Math.sin(b), z = Math.cos(b) * Math.cos(g);
  return [-x * Math.cos(s) + y * Math.sin(s), x * Math.sin(s) + y * Math.cos(s), z];
}
// Which landscape grip (90 / 270) the phone is held in, from gravity alone, so OS rotation lock does not matter.
export function landscapeGrip(beta, gamma, current, threshold = 0.35) {
  const v = gravity(beta, gamma, 0);
  if (!v) return current;
  if (v[0] < -threshold) return 90;
  if (v[0] > threshold) return 270;
  return current;
}
export function tiltFromCenter(v, center) {
  if (!v || !center) return { x: 0, y: 0 };
  let right = normalize([1 - center[0] ** 2, -center[0] * center[1], -center[0] * center[2]]) || [0, 0, 1];
  let down = normalize([-center[1] * center[0], 1 - center[1] ** 2, -center[1] * center[2]]) || [0, 0, 1];
  const base = dot(v, center);
  return { x: Math.atan2(dot(v, right), base) / rad, y: Math.atan2(dot(v, down), base) / rad };
}
export function smoothVector(previous, next, elapsedMs, tau = FEEL.smoothingMs) {
  if (!previous) return [...next];
  const a = 1 - Math.exp(-Math.min(100, elapsedMs) / tau);
  return normalize(next.map((v, i) => previous[i] + a * (v - previous[i])));
}
// Degrees of sideways tilt -> steering in [-1, 1]: dead zone, proportional, slightly progressive for fine control near centre.
export function steerFromDegrees(deg, { deadZone = FEEL.deadZone, fullTilt = FEEL.fullTilt } = {}) {
  const m = Math.abs(deg);
  if (m <= deadZone) return 0;
  const k = Math.min(1, (m - deadZone) / (fullTilt - deadZone));
  return Math.sign(deg) * Math.pow(k, 1.25);
}

export const SENSITIVITY = Object.freeze([{ id: 'high', label: '高', fullTilt: 16 }, { id: 'mid', label: '標準', fullTilt: 24 }, { id: 'low', label: '低', fullTilt: 34 }]);

export class TiltController {
  constructor(settings = {}) {
    this.invert = !!settings.invert; this.sens = settings.sens ?? 1; this.enabled = settings.enabled ?? true;
    this.permission = 'unknown';            // unknown | granted | denied | unavailable
    this.grip = 90; this.filtered = null; this.latest = null; this.center = null;
    this.lastSensorAt = -1e9; this.pendingCenter = false; this.rampStart = -1e9; this.flipSince = 0; this.samples = 0;
  }
  get fullTilt() { return SENSITIVITY[this.sens].fullTilt; }
  // true when sensor data is flowing and a centre exists
  active(now) { return this.enabled && this.permission === 'granted' && !!this.center && now - this.lastSensorAt <= FEEL.sensorTimeoutMs; }
  waiting(now) { return this.enabled && this.permission === 'granted' && !this.active(now); }
  feed(beta, gamma, now) {
    if (this.permission !== 'granted') return;
    const next = landscapeGrip(beta, gamma, this.grip);
    if (next !== this.grip) {
      if (!this.center) { this.grip = next; this.flipSince = 0; }        // before calibration the grip simply follows the hand
      else if (!this.flipSince) this.flipSince = now;
      else if (now - this.flipSince > FEEL.gripHoldMs) {               // turned over: axes changed, re-centre softly
        this.grip = next; this.flipSince = 0; this.filtered = null; this.recenter(now);
      }
    } else this.flipSince = 0;
    const v = gravity(beta, gamma, this.grip);
    if (!v) return;
    this.filtered = smoothVector(this.filtered, v, now - this.lastSensorAt > 1000 ? 100 : now - this.lastSensorAt);
    this.latest = v; this.lastSensorAt = now; this.samples++;
    if (this.pendingCenter) { this.center = [...this.filtered]; this.pendingCenter = false; this.rampStart = now; }
  }
  // Use the current hold as neutral. Applied on the next sensor sample; steering ramps back in smoothly.
  recenter(now = 0) { this.pendingCenter = true; this.center = null; this.rampStart = now; }
  // Pause / resume / rotation: neutral immediately, then ramp, never a sudden full-lock.
  softReset(now) { this.rampStart = now; }
  // value in [-1, 1]; exactly 0 when the sensor is stale, not calibrated, or disabled
  steer(now) {
    if (!this.active(now)) return 0;
    const t = tiltFromCenter(this.filtered, this.center);
    let s = steerFromDegrees(t.x, { fullTilt: this.fullTilt });
    if (this.invert) s = -s;
    const ramp = Math.max(0, Math.min(1, (now - this.rampStart) / FEEL.rampMs));
    return s * ramp;
  }
  rawDegrees() { return this.center && this.filtered ? tiltFromCenter(this.filtered, this.center).x : 0; }
}
