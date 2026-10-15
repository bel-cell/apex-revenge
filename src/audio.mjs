// All sound is synthesized with WebAudio (no assets). Engine, wind, near-miss whoosh, combo notes, crash, tunnel reverb, tiny BGM.
export function createAudio() {
  let ctx = null, master, engine, engineGain, engineFilter, wind, windGain, windFilter, wetGain, bgmGain, timer = null, step = 0;
  const noiseBuffer = c => { const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  function start() {
    if (ctx) { ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
    // tunnel reverb: a feedback delay fed from the master bus
    const delay = ctx.createDelay(1); delay.delayTime.value = 0.09; const fb = ctx.createGain(); fb.gain.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    wetGain = ctx.createGain(); wetGain.gain.value = 0;
    master.connect(wetGain); wetGain.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(ctx.destination);
    engine = ctx.createOscillator(); engine.type = 'sawtooth'; engine.frequency.value = 55;
    const sub = ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = 27;
    engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 500; engineFilter.Q.value = 3;
    engineGain = ctx.createGain(); engineGain.gain.value = 0.0;
    engine.connect(engineFilter); sub.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(master);
    engine.start(); sub.start(); engine._sub = sub;
    wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(ctx); wind.loop = true;
    windFilter = ctx.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 600; windFilter.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0; wind.connect(windFilter); windFilter.connect(windGain); windGain.connect(master); wind.start();
    bgmGain = ctx.createGain(); bgmGain.gain.value = 0.0; bgmGain.connect(master);
  }
  const tone = (freq, dur, type = 'sine', vol = 0.2, dest = master, when = 0) => {
    if (!ctx) return; const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  };
  const noise = (dur, f0, f1, vol, q = 1.2, side = 0) => {
    if (!ctx) return; const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g; if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = side; g.connect(p); out = p; }
    s.connect(f); f.connect(g); out.connect(master); s.start(t); s.stop(t + dur + 0.05);
  };
  // 8th-note bass/arp loop (A minor, 126 bpm)
  const BASS = [55, 55, 65.4, 55, 73.4, 73.4, 65.4, 49], ARP = [220, 261.6, 329.6, 261.6, 293.7, 349.2, 440, 349.2];
  function startBgm() {
    if (!ctx || timer) return; bgmGain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.5);
    timer = setInterval(() => {
      const b = BASS[step % 8]; tone(b, 0.22, 'sawtooth', 0.22, bgmGain);
      if (step % 2 === 0) tone(ARP[(step >> 1) % 8] * (step % 16 < 8 ? 1 : 1.5), 0.16, 'triangle', 0.1, bgmGain);
      if (step % 4 === 2) noise(0.06, 6000, 4000, 0.1, 2);
      step++;
    }, 60000 / 126 / 2);
  }
  function stopBgm() { clearInterval(timer); timer = null; if (ctx) bgmGain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); }
  return {
    start, startBgm, stopBgm,
    update({ speed, throttle, tunnel, running }) {
      if (!ctx) return; const t = ctx.currentTime, k = speed / 66;
      engine.frequency.setTargetAtTime(48 + k * 150 + throttle * 12, t, 0.08); engine._sub.frequency.setTargetAtTime(24 + k * 75, t, 0.08);
      engineFilter.frequency.setTargetAtTime(350 + k * 1400 + throttle * 500, t, 0.1);
      engineGain.gain.setTargetAtTime(running ? 0.12 + 0.1 * throttle : 0, t, 0.1);
      windGain.gain.setTargetAtTime(running ? 0.03 + 0.38 * k * k : 0, t, 0.15); windFilter.frequency.setTargetAtTime(300 + 1500 * k, t, 0.15);
      wetGain.gain.setTargetAtTime(tunnel ? 0.5 : 0, t, 0.4);
    },
    near(combo, side) { noise(0.35, 700, 3200, 0.5, 1.5, side * 0.7); tone(520 * Math.pow(1.0595, Math.min(combo, 12) * 2), 0.18, 'triangle', 0.22, master, 0.04); tone(780 * Math.pow(1.0595, Math.min(combo, 12) * 2), 0.18, 'sine', 0.14, master, 0.1); },
    double(combo) { noise(0.5, 400, 4500, 0.6, 1.2, 0); [523, 659, 784, 1047].forEach((f, i) => tone(f * Math.pow(1.0595, Math.min(combo, 8)), 0.22, 'triangle', 0.22, master, 0.04 + i * 0.07)); },
    pass() { noise(0.18, 500, 1400, 0.16, 1, 0); },
    crash() { noise(0.5, 900, 80, 0.9, 0.7); tone(70, 0.4, 'square', 0.4); tone(48, 0.55, 'sawtooth', 0.3); },
    end() { tone(392, 0.3, 'triangle', 0.25); tone(523, 0.3, 'triangle', 0.25, master, 0.18); tone(659, 0.5, 'triangle', 0.25, master, 0.36); },
    tunnelExit() { noise(0.9, 300, 4000, 0.4, 0.5); tone(880, 0.5, 'sine', 0.12); }
  };
}
