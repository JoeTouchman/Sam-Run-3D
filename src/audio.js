// Music + sound effects, all routed through one Web Audio graph so a single
// gain node controls volume (iOS ignores HTMLAudioElement.volume).
//
//   sfx buffers ─► sfxGain ─┐
//   <audio> music ─► musicGain ─┴► master ─► speakers
//
// Everything is silenced (music paused, context suspended) whenever the page
// is hidden, so nothing keeps playing after you leave the tab or lock the phone.

const BASE = 'assets/audio/';
const SFX = {
  gains: { file: 'SFX/dumbellPickup.mp3', vol: 0.45 },
  jump: { file: 'SFX/jump.mp3', vol: 0.7 },
  lane: { file: 'SFX/laneSwitchAndSlide.mp3', vol: 0.6 },
  hit: { file: 'SFX/hit.mp3', vol: 0.9 },
  crash: { file: 'SFX/bigCrash.mp3', vol: 0.9 },
  gulp: { file: 'SFX/singleGulp.mp3', vol: 0.9 },
  drink: { file: 'SFX/drinkOpen.mp3', vol: 0.9 },
  boost: { file: 'SFX/rocketLoop.mp3', vol: 0.55 },
  phone: { file: 'SFX/textNotification.mp3', vol: 0.8 },
  horn: { file: 'SFX/airHorn.mp3', vol: 0.7 },
};
const MUSIC = {
  theme: { file: 'music/theme.mp3', vol: 0.6 },
  run: { file: 'music/run.mp3', vol: 0.45 },
};

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = AC ? new AC() : null;
let master, sfxGain, musicGain;
const buffers = {};
const tracks = {};
let unlocked = false;
let hidden = document.hidden;
let wantTrack = null; // what should be playing when audible
let boostSrc = null;

let volume = store.get('samrun.sound.volume', 0.8);
let muted = store.get('samrun.sound.muted', false);

if (ctx) {
  master = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  sfxGain.connect(master);
  musicGain.connect(master);
  master.connect(ctx.destination);
  applyVolume();

  for (const [name, def] of Object.entries(SFX)) {
    fetch(BASE + def.file)
      .then((r) => r.arrayBuffer())
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((buf) => { buffers[name] = buf; })
      .catch(() => { /* a missing sound shouldn't break the game */ });
  }
  for (const [name, def] of Object.entries(MUSIC)) {
    const el = new Audio(BASE + def.file);
    el.loop = true;
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    const g = ctx.createGain();
    g.gain.value = def.vol;
    ctx.createMediaElementSource(el).connect(g).connect(musicGain);
    tracks[name] = el;
  }
}

function applyVolume() {
  if (!master) return;
  master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}

function audible() { return ctx && unlocked && !hidden; }

function syncMusic() {
  if (!ctx) return;
  for (const [name, el] of Object.entries(tracks)) {
    const shouldPlay = audible() && name === wantTrack;
    if (shouldPlay && el.paused) el.play().catch(() => {});
    if (!shouldPlay && !el.paused) el.pause();
  }
}

function sleep() {
  hidden = true;
  syncMusic();
  stopBoost();
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

function wake() {
  hidden = document.hidden;
  if (hidden || !unlocked) return;
  ctx.resume().catch(() => {});
  syncMusic();
}

document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
window.addEventListener('pagehide', sleep);
window.addEventListener('pageshow', wake);
window.addEventListener('freeze', sleep);

export const Sound = {
  // for debugging: what's actually playing right now
  get state() {
    return { ctx: ctx?.state, playing: Object.keys(tracks).filter((k) => !tracks[k].paused), want: wantTrack, unlocked, hidden };
  },
  get volume() { return volume; },
  get muted() { return muted; },

  // Browsers only allow audio after a user gesture; call this from input handlers.
  unlock() {
    if (!ctx) return;
    if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {});
    if (!unlocked) {
      unlocked = true;
      syncMusic();
    }
  },

  setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (volume > 0 && muted) muted = false;
    store.set('samrun.sound.volume', volume);
    store.set('samrun.sound.muted', muted);
    applyVolume();
  },

  toggleMute() {
    muted = !muted;
    store.set('samrun.sound.muted', muted);
    applyVolume();
    return muted;
  },

  play(name, { rate = 1, vol = 1 } = {}) {
    if (!audible() || !buffers[name]) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = SFX[name].vol * vol;
    src.connect(g).connect(sfxGain);
    src.start();
  },

  // 'theme' | 'run' | null. restart=true rewinds the track.
  music(name, { restart = false } = {}) {
    if (!ctx) return;
    if (restart && tracks[name]) tracks[name].currentTime = 0;
    if (name !== wantTrack && tracks[name] && !restart) {
      // switching tracks: fade the new one in
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(0, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.6);
    }
    wantTrack = name;
    syncMusic();
  },

  boost(on) {
    if (on) {
      if (boostSrc || !audible() || !buffers.boost) return;
      boostSrc = ctx.createBufferSource();
      boostSrc.buffer = buffers.boost;
      boostSrc.loop = true;
      const g = ctx.createGain();
      g.gain.value = SFX.boost.vol;
      boostSrc.connect(g).connect(sfxGain);
      boostSrc.start();
    } else stopBoost();
  },
};

function stopBoost() {
  if (!boostSrc) return;
  try { boostSrc.stop(); } catch { /* already stopped */ }
  boostSrc = null;
}
