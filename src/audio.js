// Tiny synthesized sound effects — no audio files to download.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let ctx = null;
let master = null;
let muted = store.get('samrun.muted', false);

export const Sfx = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    store.set('samrun.muted', muted);
    if (master) master.gain.value = muted ? 0 : 0.7;
    return muted;
  },
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.12, slide = 0, delay = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.2, freq = 800) {
    if (!ctx || muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(master);
    src.start();
  },
  coin() { this.tone(1320, 0.07, 'square', 0.06); this.tone(1760, 0.09, 'square', 0.06, 0, 0.05); },
  jump() { this.tone(280, 0.18, 'triangle', 0.14, 420); },
  slide() { this.noise(0.25, 0.18, 1400); },
  lane() { this.tone(520, 0.05, 'triangle', 0.05, 120); },
  hit() { this.noise(0.35, 0.5, 500); this.tone(140, 0.35, 'sawtooth', 0.14, -90); },
  smash() { this.noise(0.25, 0.35, 2200); this.tone(700, 0.15, 'square', 0.08, -400); },
  power() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.12, 'square', 0.08, 0, i * 0.07)); },
  phone() { this.tone(988, 0.09, 'sine', 0.14); this.tone(1319, 0.2, 'sine', 0.14, 0, 0.1); },
  over() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, 0, i * 0.16)); },
};

export { store };
