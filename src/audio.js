// Music + sound effects, all routed through one Web Audio graph so gain nodes control
// volume (iOS ignores HTMLAudioElement.volume).
//
//   sfx buffers ─► sfxGain (sfx volume) ────────────────────┐
//   <audio> music ─► musicGain (fades) ─► musicLevel (music volume) ─┴► master (mute) ─► speakers
//
// The page's audio session is "ambient", so on iPhone the game mixes with Spotify etc.
// instead of pausing it (and stays out of the lock screen's Now Playing controls).
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

// Must be set before any audio starts. Safari 16.4+; elsewhere it's a no-op.
try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* unsupported */ }

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = AC ? new AC() : null;
let master, sfxGain, musicGain, musicLevel;
const buffers = {};
const tracks = {};
let unlocked = false;
let hidden = document.hidden;
let wantTrack = null; // what should be playing when audible
let boostSrc = null;
// Another Sam Run tab/window took over the music; stay quiet until this one is touched again.
let yielded = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('samrun-audio') : null;
const tabId = Math.random().toString(36).slice(2);
if (channel) {
  channel.onmessage = (e) => {
    if (e.data?.type === 'music' && e.data.tab !== tabId && !yielded) {
      yielded = true;
      syncMusic();
    }
  };
}

// separate music / sfx volumes; older saves had one shared volume
const oldVolume = store.get('samrun.sound.volume', 0.8);
let musicVolume = store.get('samrun.sound.music', oldVolume);
let sfxVolume = store.get('samrun.sound.sfx', oldVolume);
let muted = store.get('samrun.sound.muted', false);

if (ctx) {
  master = ctx.createGain();
  sfxGain = ctx.createGain();
  musicGain = ctx.createGain();
  musicLevel = ctx.createGain();
  sfxGain.connect(master);
  musicGain.connect(musicLevel).connect(master);
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
    // Safety net: if a track starts when it shouldn't (e.g. a play() that resolved
    // after we already asked it to stop), shut it off straight away.
    el.addEventListener('playing', () => {
      if (!(audible() && name === wantTrack)) el.pause();
    });
    tracks[name] = el;
  }
}

function applyVolume() {
  if (!master) return;
  master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  musicLevel.gain.setTargetAtTime(musicVolume, ctx.currentTime, 0.02);
  sfxGain.gain.setTargetAtTime(sfxVolume, ctx.currentTime, 0.02);
}

function audible() { return ctx && unlocked && !hidden && !yielded; }

function syncMusic() {
  if (!ctx) return;
  for (const [name, el] of Object.entries(tracks)) {
    const shouldPlay = audible() && name === wantTrack;
    if (shouldPlay && el.paused) {
      if (!el.getAttribute('src')) { // reattach after sleep() unloaded it
        el.src = BASE + MUSIC[name].file;
        el.currentTime = el.dataset.t ? Number(el.dataset.t) : 0;
      }
      el.play().catch(() => {});
      channel?.postMessage({ type: 'music', tab: tabId });
    }
    if (!shouldPlay && !el.paused) el.pause();
  }
}

function sleep() {
  hidden = true;
  syncMusic();
  // Unload the music so iOS drops its lock-screen / home-screen Now Playing controls
  // (a paused <audio> keeps them around, and their play button can't do anything).
  for (const el of Object.values(tracks)) {
    if (!el.getAttribute('src')) continue;
    el.dataset.t = el.currentTime || 0;
    el.removeAttribute('src');
    el.load();
  }
  if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
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
  get musicVolume() { return musicVolume; },
  get sfxVolume() { return sfxVolume; },
  get muted() { return muted; },

  // Browsers only allow audio after a user gesture; call this from input handlers.
  unlock() {
    if (!ctx) return;
    if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {});
    if (!unlocked || yielded) {
      unlocked = true;
      yielded = false; // the tab you're playing in gets the music back
      syncMusic();
    }
  },

  // kind: 'music' | 'sfx'
  setVolume(kind, v) {
    v = Math.max(0, Math.min(1, v));
    if (kind === 'music') musicVolume = v; else sfxVolume = v;
    if (v > 0 && muted) muted = false;
    store.set('samrun.sound.music', musicVolume);
    store.set('samrun.sound.sfx', sfxVolume);
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
    if (restart && tracks[name]) { tracks[name].currentTime = 0; tracks[name].dataset.t = 0; }
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
