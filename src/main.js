import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Sound } from './audio.js';
import { fetchTop, submitScore, cleanName, NAME_PATTERN } from './leaderboard.js';
import {
  LANE_W, LANES, PATH_W, GROUND_LEN, CHUNK,
  makePathTexture, makeGrassTexture, makeSky, buildChunk, buildArch, OBSTACLES, PICKUPS,
} from './world.js';

const $ = (id) => document.getElementById(id);
const icon = (id) => `<svg class="ico"><use href="#i-${id}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ---------- tuning ----------
const SAM_HEIGHT = 1.8;
const SPAWN_Z = -150;
const DESPAWN_Z = 12;
const GRAVITY = 36;
const JUMP_V = 12;
const SLIDE_TIME = 1.0;
const START_SPEED = 13;
const MAX_SPEED = 30;
const INJURY_TIME = 6;
const POWER_TIME = { beer: 9, boost: 5 };
const TILE = 8; // path texture tile length (world units)

// ---------- copy ----------
const HIT_QUIPS = ['Pulled a hammy!', 'Not the quads!!', 'Walk it off, bro', 'That one’s going on the story', 'Ice bath tonight', 'Bro’s limping'];
const ROASTS = {
  slug: ['Taken out by a banana slug. Go Slugs, I guess.', 'Lost a race to a slug. The slug didn’t even move.'],
  turkey: ['Bested by a wild turkey. Nature is healing.', 'The turkey had more aura.'],
  log: ['Redwood 1, Sam 0.', 'Tripped on a log. Skipped leg day again?'],
  logWide: ['Redwood 1, Sam 0.', 'Tripped on a log. Skipped leg day again?'],
  banner: ['Clotheslined by a campus banner.', 'Forgot to duck. Go Slugs, I guess.'],
  bannerWide: ['Clotheslined by a campus banner.', 'Forgot to duck. Go Slugs, I guess.'],
  bus: ['Hit by the Loop bus. At least it was on time for once.', 'Should’ve taken the bus instead of getting hit by it.'],
};
const GENERIC_ROASTS = ['She’s not texting back, bro.', 'Worse than your Rocket League ranked games.', 'Should’ve skipped the 4th White Claw.', 'The blondes at Cowell saw that.'];
const PHONE_QUIPS = ['Got her instagram!', 'She followed back!', 'Digits secured!', 'Got her number!'];
const MILESTONES = [
  [250, 'Warming up'], [500, 'Cardio king'], [1000, 'Beast mode'], [1500, 'Down to Cowell Beach'],
  [2000, 'Protein shake overdose'], [3000, 'Supersonic legend'], [5000, 'Touch grass, Sam'],
];

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xf5b98f);
scene.background = FOG;
scene.fog = new THREE.Fog(FOG, 50, 170);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 900);
let baseFov = 60;

const sky = makeSky(FOG);
scene.add(sky);

scene.add(new THREE.HemisphereLight(0xffe6cc, 0x5c7a3a, 1.9));
const sun = new THREE.DirectionalLight(0xffe0b8, 2.6);
sun.position.set(-7, 16, 9);
sun.target.position.set(0, 0, -8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 26, bottom: -14, near: 1, far: 60 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ground: path + grass + ocean
const pathTex = makePathTexture();
pathTex.repeat.set(1, GROUND_LEN / TILE);
const path = new THREE.Mesh(new THREE.PlaneGeometry(PATH_W, GROUND_LEN), new THREE.MeshLambertMaterial({ map: pathTex }));
path.rotation.x = -Math.PI / 2;
path.position.set(0, 0.01, -GROUND_LEN / 2 + 30);
path.receiveShadow = true;
scene.add(path);

const grassTex = makeGrassTexture();
const GRASS_W = 150;
grassTex.repeat.set(GRASS_W / 6, GROUND_LEN / 6);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(GRASS_W, GROUND_LEN), new THREE.MeshLambertMaterial({ map: grassTex }));
grass.rotation.x = -Math.PI / 2;
grass.position.set(-GRASS_W / 2 + 45, -0.02, -GROUND_LEN / 2 + 30);
grass.receiveShadow = true;
scene.add(grass);

const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1400), new THREE.MeshLambertMaterial({ color: 0x3f7fa8 }));
ocean.rotation.x = -Math.PI / 2;
ocean.position.set(45 + 600, -4, -300);
scene.add(ocean);
const cliff = new THREE.Mesh(new THREE.BoxGeometry(3, 4.2, GROUND_LEN), new THREE.MeshLambertMaterial({ color: 0x9a7b5a }));
cliff.position.set(45, -2.1, -GROUND_LEN / 2 + 30);
scene.add(cliff);

for (const s of [-1, 1]) {
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, GROUND_LEN), new THREE.MeshLambertMaterial({ color: 0xd8cfbf }));
  curb.position.set(s * (PATH_W / 2 + 0.1), 0.09, -GROUND_LEN / 2 + 30);
  curb.receiveShadow = true;
  scene.add(curb);
}

// scenery chunks (pool of variants, a subset active at a time)
const NCHUNK = Math.ceil((GROUND_LEN - 20) / CHUNK) + 1;
const chunkPool = [];
const chunks = [];
for (let i = 0; i < NCHUNK + 5; i++) {
  const c = buildChunk();
  c.visible = false;
  scene.add(c);
  chunkPool.push(c);
}
function placeChunk(z) {
  const i = Math.floor(Math.random() * chunkPool.length);
  const c = chunkPool.splice(i, 1)[0];
  c.position.z = z;
  c.visible = true;
  chunks.push(c);
}
for (let i = 0; i < NCHUNK; i++) placeChunk(20 - i * CHUNK);

const arch = buildArch();
arch.position.z = -400;
scene.add(arch);
let archIdx = 0;

// ---------- Sam ----------
const player = new THREE.Group(); // at Sam's feet; handles lane/jump/tilt
const samInner = new THREE.Group(); // faces away from the camera
samInner.rotation.y = Math.PI;
player.add(samInner);
scene.add(player);

let sam, mixer;
const actions = {};
let currentAnim = null;
const ANIM_REF_SPEED = { slow: 9, run: 14, fast: 24, injured: 11, drunk: 12, dance: 0 };

// boost flame + shield bubble
const flame = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 1.1, 10, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
);
flame.rotation.x = Math.PI / 2; // tip trails back toward the camera
flame.position.set(0, 1.15, 0.8);
flame.visible = false;
player.add(flame);
const flame2 = new THREE.Mesh(flame.geometry, new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
flame2.scale.setScalar(0.55);
flame.add(flame2);

const bubble = new THREE.Mesh(
  new THREE.SphereGeometry(1.25, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0x5ce1ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
);
bubble.position.y = 0.95;
bubble.visible = false;
player.add(bubble);

function setAnim(name, fade = 0.25) {
  if (!mixer || currentAnim === name || !actions[name]) return;
  const next = actions[name];
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (currentAnim) actions[currentAnim].fadeOut(fade);
  currentAnim = name;
}

// Mixamo has no "in place" option for these clips, so lock the hips' root motion here.
// lockY also flattens the vertical lift (the jump's height comes from game physics instead).
function inPlace(clip, lockY = false) {
  for (const t of clip.tracks) {
    if (/Hips\.position$/.test(t.name)) {
      const v = t.values;
      const [x0, y0, z0] = v;
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0;
        v[i + 2] = z0;
        if (lockY) v[i + 1] = y0;
      }
    }
  }
  return clip;
}

// One-shot clips (jump, slide) restart every time they're triggered.
function playOnce(name, timeScale, fade = 0.1) {
  const a = actions[name];
  if (!a) return;
  a.reset();
  a.timeScale = timeScale;
  if (currentAnim !== name) {
    a.setEffectiveWeight(1).fadeIn(fade);
    if (currentAnim) actions[currentAnim].fadeOut(fade);
    currentAnim = name;
  }
  a.play();
}

// ---------- loading ----------
const FILES = [
  ['sam', 'assets/sam.fbx', 12797412],
  ['run', 'assets/anims/run.fbx', 222608],
  ['fast', 'assets/anims/fast.fbx', 208240],
  ['slow', 'assets/anims/slow.fbx', 230048],
  ['injured', 'assets/anims/injured.fbx', 219184],
  ['drunk', 'assets/anims/drunk.fbx', 310048],
  ['dance', 'assets/anims/dance.fbx', 907072],
  ['jump', 'assets/anims/jump.fbx', 242480],
  ['slide', 'assets/anims/slide.fbx', 283040],
];
const LOAD_LINES = ['Loading Sam’s pre-workout…', 'Hitting the gym…', 'Fixing his hair…', 'Texting the group chat…', 'Queueing Rocket League…', 'Stretching hamstrings…'];

async function load() {
  const loader = new FBXLoader();
  const total = FILES.reduce((a, f) => a + f[2], 0);
  const loaded = {};
  let lineI = 0;
  const lineTimer = setInterval(() => { $('loadText').textContent = LOAD_LINES[++lineI % LOAD_LINES.length]; }, 1400);
  const bump = () => {
    const sum = Object.values(loaded).reduce((a, b) => a + b, 0);
    $('barFill').style.width = `${Math.min(97, (sum / total) * 100)}%`;
  };
  const objs = await Promise.all(FILES.map(([key, url, size]) => new Promise((resolve, reject) => {
    loader.load(url, (o) => { loaded[key] = size; bump(); resolve([key, o]); }, (e) => { loaded[key] = Math.min(e.loaded, size); bump(); }, reject);
  })));
  clearInterval(lineTimer);
  const byKey = Object.fromEntries(objs);

  sam = byKey.sam;
  sam.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.shininess !== undefined) m.shininess = 6;
        if (m.specular) m.specular.setHex(0x151515);
        if (m.color && m.map) m.color.setHex(0xffffff);
      }
    }
  });
  const box = new THREE.Box3().setFromObject(sam);
  sam.scale.multiplyScalar(SAM_HEIGHT / (box.max.y - box.min.y));
  samInner.add(sam);

  mixer = new THREE.AnimationMixer(sam);
  for (const key of ['run', 'fast', 'slow', 'injured', 'drunk', 'dance', 'jump', 'slide']) {
    const clip = byKey[key].animations[0];
    if (!clip) continue;
    if (key !== 'dance') inPlace(clip, key === 'jump');
    const a = mixer.clipAction(clip);
    if (key === 'jump' || key === 'slide') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    actions[key] = a;
  }

  // Ground Sam using an animated pose — the T-pose rest skeleton sits at a different hip height.
  actions.run.play();
  mixer.update(0);
  sam.updateMatrixWorld(true);
  sam.traverse((o) => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
  sam.position.y -= new THREE.Box3().setFromObject(sam).min.y;
  actions.run.stop();
  $('barFill').style.width = '100%';
}

// ---------- game state ----------
let state = 'loading'; // loading | menu | intro | run | dying | over | paused
let prevState = null;
let lane = 1;
let prevLane = 1;
let px = 0, py = 0, vy = 0;
let grounded = true;
let slideT = 0;
let queuedSlide = false;
let speed = 0;
let distance = 0;
let score = 0;
let gains = 0;
let digits = 0;
let smashes = 0;
let runTime = 0;
let injuredT = 0;
let invulnT = 0;
let shield = false;
const power = { beer: 0, boost: 0 };
let shake = 0;
let introT = 0;
let dyingT = 0;
let milestoneI = 0;
let rowGap = 24;
let sinceRow = 0;
// Buses are the only obstacles you can't jump or slide past, so the spawner keeps
// bus rows apart: never two bus rows in a row, and an oncoming (faster) bus only
// when the rows ahead of it are bus-free, so it can't catch up and close the last lane.
let rowsSinceBus = 99;
let sinceArch = 0;
let best = store.get('samrun.best', 0);
let killer = null;
let celebrate = false;

const obstacles = [];
const pickups = [];
const pools = {};

function spawnObstacle(type, x, z, vz = 0) {
  const def = OBSTACLES[type];
  const pool = (pools[type] ||= []);
  const mesh = pool.pop() || def.build();
  if (!mesh.parent) scene.add(mesh);
  mesh.visible = true;
  mesh.position.set(x, 0, z);
  mesh.rotation.set(0, 0, 0);
  const e = { type, mesh, x, z, vz, w: def.w, len: def.len, bottom: def.bottom, top: def.top, dead: false, fly: null };
  obstacles.push(e);
  return e;
}

function spawnPickup(type, x, z, y) {
  const def = PICKUPS[type];
  const pool = (pools['p_' + type] ||= []);
  const mesh = pool.pop() || def.build();
  if (!mesh.parent) scene.add(mesh);
  mesh.visible = true;
  mesh.scale.setScalar(1);
  const e = { type, mesh, x, z, y: y ?? def.y, taken: false, t: Math.random() * 6 };
  mesh.position.set(x, e.y, z);
  pickups.push(e);
  return e;
}

function recycle(list, i, prefix = '') {
  const e = list[i];
  e.mesh.visible = false;
  (pools[prefix + e.type] ||= []).push(e.mesh);
  list[i] = list[list.length - 1];
  list.pop();
}

function coinLine(laneI, z, n = 6, gap = 2.3) {
  for (let k = 0; k < n; k++) spawnPickup('gains', LANES[laneI], z - k * gap);
}
function coinArc(laneI, z) {
  const n = 7;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    spawnPickup('gains', LANES[laneI], z + 5.5 - f * 11, 0.9 + Math.sin(f * Math.PI) * 1.9);
  }
}

function spawnPower(laneI, z) {
  const r = Math.random();
  const type = r < 0.28 ? 'beer' : r < 0.52 ? 'boost' : r < 0.78 ? 'shake' : 'phone';
  spawnPickup(type, LANES[laneI], z);
}

function spawnRow(z) {
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
  const small = ['slug', 'turkey', 'log', 'banner'];
  const d = distance;
  let r = Math.random();
  if (rowsSinceBus < 1 && r < 0.28) r = 0.28 + Math.random() * 0.72; // no back-to-back bus rows
  let free = [];
  let bus = false;

  if (d < 140) {
    const t = pick(['slug', 'turkey', 'log', 'banner']);
    spawnObstacle(t, LANES[lanes[0]], z);
    free = [lanes[1], lanes[2]];
  } else if (r < 0.16) {
    // one bus + one small
    const oncoming = d > 500 && rowsSinceBus >= 5 && Math.random() < 0.35;
    bus = true;
    spawnObstacle('bus', LANES[lanes[0]], z - 5, oncoming ? 7 : 0);
    spawnObstacle(pick(small), LANES[lanes[1]], z);
    free = [lanes[2]];
  } else if (r < 0.28) {
    bus = true;
    spawnObstacle('bus', LANES[lanes[0]], z - 5);
    spawnObstacle('bus', LANES[lanes[1]], z - 5 - rand(0, 4));
    free = [lanes[2]];
  } else if (r < 0.38) {
    spawnObstacle('logWide', 0, z);
    coinArc(lanes[0], z);
    free = [];
  } else if (r < 0.48) {
    spawnObstacle('bannerWide', 0, z);
    free = [lanes[0]];
  } else if (r < 0.74) {
    spawnObstacle(pick(small), LANES[lanes[0]], z);
    spawnObstacle(pick(small), LANES[lanes[1]], z + rand(-1, 1));
    free = [lanes[2]];
  } else {
    const t = pick(['slug', 'turkey', 'log']);
    spawnObstacle(t, LANES[lanes[0]], z);
    coinArc(lanes[0], z);
    if (Math.random() < 0.5) { spawnObstacle(pick(small), LANES[lanes[1]], z - 3); free = [lanes[2]]; } else free = [lanes[1], lanes[2]];
  }

  rowsSinceBus = bus ? 0 : rowsSinceBus + 1;

  if (free.length) {
    const fl = pick(free);
    if (d > 60 && Math.random() < 0.09) spawnPower(fl, z - 6);
    else if (Math.random() < 0.75) coinLine(fl, z + 4, 5 + Math.floor(Math.random() * 4));
  }
}

function resetRun() {
  for (let i = obstacles.length - 1; i >= 0; i--) recycle(obstacles, i);
  for (let i = pickups.length - 1; i >= 0; i--) recycle(pickups, i, 'p_');
  lane = 1; px = 0; py = 0; vy = 0; grounded = true; slideT = 0; queuedSlide = false;
  speed = 0; distance = 0; score = 0; gains = 0; digits = 0; smashes = 0; runTime = 0;
  injuredT = 0; invulnT = 0; shield = false; power.beer = 0; power.boost = 0;
  shake = 0; milestoneI = 0; sinceRow = 0; rowGap = 24; rowsSinceBus = 99; killer = null; sinceArch = 0;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  samInner.visible = true;
  if (mixer) mixer.timeScale = 1;
  // pre-populate the road ahead
  for (let z = -45; z > SPAWN_Z; z -= 24) spawnRow(z);
  arch.position.z = -120;
  lastHud = {};
}

// ---------- HUD ----------
let lastHud = {};
function setText(id, v) {
  if (lastHud[id] === v) return;
  lastHud[id] = v;
  $(id).textContent = v;
}
let toastTimer = 0;
function toast(main, small = '') {
  const el = $('toast');
  el.innerHTML = small ? `${main}<small>${small}</small>` : main;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1700);
}
function flashRed() {
  const f = $('flash');
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
}
function updatePowersHud() {
  const items = [];
  if (power.boost > 0) items.push(['boost', power.boost / POWER_TIME.boost]);
  if (power.beer > 0) items.push(['cup', power.beer / POWER_TIME.beer]);
  if (shield) items.push(['shake', 1]);
  if (injuredT > 0) items.push(['bandage', injuredT / INJURY_TIME]);
  const key = items.map((i) => i[0] + Math.round(i[1] * 40)).join();
  if (lastHud.powers === key) return;
  lastHud.powers = key;
  $('powers').innerHTML = items.map(([ico, f]) => `<div class="power">${icon(ico)}<div class="t"><i style="width:${(f * 100).toFixed(0)}%"></i></div></div>`).join('');
}

function showScreen(id) {
  for (const s of ['loading', 'menu', 'pause', 'over', 'board']) $(s).classList.toggle('hidden', s !== id);
  $('hud').classList.toggle('hidden', !(id === null || id === 'pause'));
}

// ---------- input ----------
function startSlide() {
  slideT = SLIDE_TIME;
  Sound.play('lane', { rate: 0.75 });
  playOnce('slide', actions.slide ? actions.slide.getClip().duration / SLIDE_TIME : 1, 0.08);
}

function act(a) {
  if (state !== 'run') return;
  if (a === 'left' && lane > 0) { prevLane = lane; lane--; Sound.play('lane'); }
  else if (a === 'right' && lane < 2) { prevLane = lane; lane++; Sound.play('lane'); }
  else if (a === 'up') {
    if (grounded) {
      vy = JUMP_V; grounded = false; slideT = 0; queuedSlide = false;
      Sound.play('jump');
      playOnce('jump', actions.jump ? actions.jump.getClip().duration / (2 * JUMP_V / GRAVITY) : 1);
    }
  } else if (a === 'down') {
    if (!grounded) { vy = -24; queuedSlide = true; }
    else startSlide();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || !$('board').classList.contains('hidden')) return;
  const k = e.key;
  if (['ArrowLeft', 'a', 'A'].includes(k)) act('left');
  else if (['ArrowRight', 'd', 'D'].includes(k)) act('right');
  else if (['ArrowUp', 'w', 'W', ' '].includes(k)) {
    if (state === 'menu' && k === ' ') startGame();
    else act('up');
  } else if (['ArrowDown', 's', 'S'].includes(k)) act('down');
  else if (k === 'Escape' || k === 'p') togglePause();
  else if (k === 'Enter' && (state === 'menu' || state === 'over')) startGame();
  if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
});

// audio can only start after a user gesture
for (const ev of ['touchstart', 'touchend', 'pointerdown', 'keydown', 'click']) window.addEventListener(ev, () => Sound.unlock(), { passive: true });

let touch = null;
window.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touch = { x: t.clientX, y: t.clientY, done: false };
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (state === 'run') e.preventDefault();
  if (!touch || touch.done) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  if (Math.hypot(dx, dy) < 24) return;
  touch.done = true;
  if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right');
  else act(dy < 0 ? 'up' : 'down');
}, { passive: false });
window.addEventListener('touchend', () => { touch = null; }, { passive: true });

// mouse drag swipes for desktop testing
let mouse = null;
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { mouse = { x: e.clientX, y: e.clientY, done: false }; } });
window.addEventListener('pointermove', (e) => {
  if (!mouse || mouse.done || e.pointerType !== 'mouse') return;
  const dx = e.clientX - mouse.x, dy = e.clientY - mouse.y;
  if (Math.hypot(dx, dy) < 30) return;
  mouse.done = true;
  if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right');
  else act(dy < 0 ? 'up' : 'down');
});
window.addEventListener('pointerup', () => { mouse = null; });

$('playBtn').addEventListener('click', () => { startGame(); });
$('againBtn').addEventListener('click', () => { startGame(); });
$('menuBtn').addEventListener('click', () => toMenu());
$('quitBtn').addEventListener('click', () => toMenu());
$('pauseBtn').addEventListener('click', () => togglePause());
$('resumeBtn').addEventListener('click', () => togglePause());
// mute button + volume slider (menu and pause screen share state)
function syncSoundUi() {
  for (const el of document.querySelectorAll('.sound')) {
    const off = Sound.muted || Sound.volume === 0;
    el.classList.toggle('off', off);
    el.querySelector('use').setAttribute('href', off ? '#i-mute' : '#i-sound');
    const r = el.querySelector('.snd-vol');
    r.value = Math.round(Sound.volume * 100);
    r.style.setProperty('--fill', `${off ? 0 : r.value}%`);
  }
}
for (const el of document.querySelectorAll('.sound')) {
  el.querySelector('.snd-btn').addEventListener('click', () => { Sound.unlock(); Sound.toggleMute(); syncSoundUi(); });
  el.querySelector('.snd-vol').addEventListener('input', (e) => { Sound.unlock(); Sound.setVolume(e.target.value / 100); syncSoundUi(); });
}
syncSoundUi();

$('shareBtn').addEventListener('click', async () => {
  const text = `I scored ${Math.floor(score)} in Sam Run 3D (${Math.floor(distance)}m, ${digits} numbers). Beat that.`;
  try {
    if (navigator.share) await navigator.share({ title: 'Sam Run 3D', text, url: location.href });
    else { await navigator.clipboard.writeText(`${text} ${location.href}`); toast('Copied!', 'Send it to the group chat'); }
  } catch { /* cancelled */ }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'run' || state === 'intro')) togglePause(); });

function togglePause() {
  if (state === 'run' || state === 'intro') { prevState = state; state = 'paused'; showScreen('pause'); Sound.music(null); Sound.boost(false); }
  else if (state === 'paused') { state = prevState || 'run'; showScreen(null); clock.getDelta(); Sound.music('run'); if (power.boost > 0) Sound.boost(true); }
}

// ---------- leaderboard ----------
let posted = false;
let boardReturn = 'menu';
let myName = store.get('samrun.name', '');

function setSubmitMsg(text, err = false) {
  const el = $('submitMsg');
  el.textContent = text;
  el.classList.toggle('err', err);
}

function prepareNameForm() {
  posted = false;
  $('nameInput').value = myName;
  $('nameInput').disabled = false;
  $('postBtn').disabled = false;
  $('postBtn').textContent = 'POST';
  setSubmitMsg(Math.floor(score) > 0 ? 'Put your name on the board' : '');
}

$('nameInput').addEventListener('input', (e) => {
  const v = cleanName(e.target.value);
  if (v !== e.target.value) e.target.value = v;
});

$('nameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (posted) return;
  const name = cleanName($('nameInput').value).trim();
  if (!name || !NAME_PATTERN.test(name)) { setSubmitMsg('Type a name first', true); return; }
  $('nameInput').blur();
  $('postBtn').disabled = true;
  $('nameInput').disabled = true;
  setSubmitMsg('Posting…');
  try {
    const r = await submitScore({ name, score, distance, gains, digits, smashes, duration: runTime });
    posted = true;
    myName = name;
    store.set('samrun.name', name);
    $('postBtn').textContent = 'POSTED';
    setSubmitMsg(r.improved ? `You're #${r.rank} on the board!` : `Your best is still ${r.best.toLocaleString()} (#${r.rank})`);
  } catch (err) {
    const m = String(err.message || '');
    setSubmitMsg(m.includes('slow down') ? 'Slow down, try again in a sec' : m.includes('invalid run') ? 'That run looks sus. Not posted.' : 'Couldn’t post. Check your connection.', true);
    $('postBtn').disabled = false;
    $('nameInput').disabled = false;
  }
});

async function openBoard(from) {
  boardReturn = from;
  showScreen('board');
  const list = $('boardList');
  list.innerHTML = '<li class="note">Loading…</li>';
  try {
    const rows = await fetchTop(100);
    list.innerHTML = '';
    if (!rows.length) { list.innerHTML = '<li class="note">No scores yet. Be the first.</li>'; return; }
    let meEl = null;
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = i + 1;
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name;
      const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = r.score.toLocaleString();
      const sm = document.createElement('small'); sm.textContent = `${r.distance.toLocaleString()}m`;
      sc.append(sm);
      li.append(rk, nm, sc);
      if (myName && r.name === myName) { li.classList.add('me'); meEl = li; }
      list.append(li);
    });
    if (meEl) meEl.scrollIntoView({ block: 'center' });
  } catch {
    list.innerHTML = '<li class="note">Couldn’t load the leaderboard. Check your connection.</li>';
  }
}

$('menuBoardBtn').addEventListener('click', () => openBoard('menu'));
$('overBoardBtn').addEventListener('click', () => openBoard('over'));
$('boardBack').addEventListener('click', () => showScreen(boardReturn));

// ---------- flow ----------
const MENU_CAM = new THREE.Vector3(0.7, 1.25, 4.0);
const MENU_LOOK = new THREE.Vector3(0, 0.55, 0);
const camLook = new THREE.Vector3();

function toMenu() {
  state = 'menu';
  resetRun();
  for (let i = obstacles.length - 1; i >= 0; i--) recycle(obstacles, i);
  for (let i = pickups.length - 1; i >= 0; i--) recycle(pickups, i, 'p_');
  setAnim('dance', 0.4);
  player.rotation.y = Math.PI; // face the camera while dancing
  $('bestLine').textContent = best ? `Personal record: ${best.toLocaleString()}` : 'Cowell’s finest. Allegedly.';
  $('drunkfx').classList.remove('on');
  Sound.boost(false);
  Sound.music('theme');
  showScreen('menu');
}

function startGame() {
  resetRun();
  state = 'intro';
  introT = 0;
  setAnim('slow', 0.35);
  Sound.boost(false);
  Sound.music('run', { restart: true });
  showScreen(null);
}

function gameOver() {
  state = 'dying';
  dyingT = 0;
  Sound.play('crash');
  Sound.boost(false);
  Sound.music(null);
  if (navigator.vibrate) navigator.vibrate([60, 40, 120]);
  const pool = ROASTS[killer] ? [...ROASTS[killer], ...GENERIC_ROASTS.slice(0, 1)] : GENERIC_ROASTS;
  $('roast').textContent = pick(pool);
  const final = Math.floor(score);
  const isBest = final > best;
  if (isBest) { best = final; store.set('samrun.best', best); }
  celebrate = isBest;
  $('oScore').textContent = final.toLocaleString();
  $('oDist').textContent = `${Math.floor(distance)}m`;
  $('oGains').textContent = gains;
  $('oDigits').textContent = digits;
  $('newBest').classList.toggle('hidden', !isBest);
  $('oBest').textContent = isBest ? '' : `Personal record: ${best.toLocaleString()}`;
  prepareNameForm();
  $('drunkfx').classList.remove('on');
}

function hit(o) {
  if (invulnT > 0 || o.dead) return;
  if (power.boost > 0 || shield) {
    smash(o);
    if (power.boost <= 0) { shield = false; toast('SHIELD POPPED', 'Protein saved you'); invulnT = 0.8; }
    return;
  }
  shake = 0.5;
  flashRed();
  killer = o.type;
  // Clipping the side of a bus bounces you back; running into its front is game over.
  const busSide = o.type === 'bus' && o.z + o.len / 2 > 1.4;
  if (injuredT > 0 || (o.type === 'bus' && !busSide)) {
    o.dead = true;
    gameOver();
    return;
  }
  if (busSide) lane = prevLane === lane ? 1 : prevLane;
  else { o.dead = true; o.fly = { vy: rand(5, 7), vx: (o.x >= px ? 1 : -1) * rand(3, 5), spin: rand(-6, 6) }; }
  if (navigator.vibrate) navigator.vibrate(80);
  Sound.play('hit');
  injuredT = INJURY_TIME;
  invulnT = 1.2;
  toast(pick(HIT_QUIPS), 'One more hit and you’re done');
}

function smash(o) {
  o.dead = true;
  smashes++;
  o.fly = { vy: rand(7, 10), vx: (o.x >= px ? 1 : -1) * rand(4, 8), spin: rand(-8, 8) };
  score += 50 * (power.beer > 0 ? 2 : 1);
  Sound.play('hit', { vol: 0.6, rate: 1.3 });
  shake = 0.2;
}

function collect(p) {
  p.taken = true;
  const mult = power.beer > 0 ? 2 : 1;
  switch (p.type) {
    case 'gains': gains++; score += 10 * mult; Sound.play('gains', { rate: rand(0.95, 1.08) }); break;
    case 'beer': power.beer = POWER_TIME.beer; Sound.play('drink'); toast(`${icon('cup')} DRUNK MODE`, '2x points'); $('drunkfx').classList.add('on'); break;
    case 'boost': power.boost = POWER_TIME.boost; Sound.boost(true); toast(`${icon('boost')} SUPERSONIC`, 'Smash through everything'); break;
    case 'shake':
      Sound.play('gulp');
      if (injuredT > 0) { injuredT = 0; toast(`${icon('shake')} PROTEIN SHAKE`, 'Fully healed. Gains restored'); }
      else { shield = true; toast(`${icon('shake')} PROTEIN SHAKE`, 'Shield up'); }
      break;
    case 'phone': digits++; score += 250 * mult; Sound.play('phone'); toast(`${icon('phone')} ${pick(PHONE_QUIPS)}`, `+${250 * mult}`); break;
  }
}

// ---------- update ----------
const clock = new THREE.Clock();
let elapsed = 0;

function update(dt) {
  elapsed += dt;
  if (mixer) mixer.update(dt);

  if (state === 'menu' || state === 'loading') {
    const a = elapsed * 0.25;
    camera.position.set(Math.sin(a) * 0.9 + MENU_CAM.x * 0.3, MENU_CAM.y, MENU_CAM.z);
    camera.lookAt(MENU_LOOK);
    return;
  }
  if (state === 'paused' || state === 'over') return;

  // --- speed ---
  const target = Math.min(MAX_SPEED, START_SPEED + distance * 0.011);
  let want = target;
  if (injuredT > 0) want *= 0.82;
  if (power.boost > 0) want *= 1.55;
  if (state === 'intro') {
    introT += dt;
    want = target * Math.min(1, introT / 1.2);
    if (introT > 1.2) state = 'run';
  }
  if (state === 'dying') want = 0;
  speed = damp(speed, want, state === 'dying' ? 6 : 3, dt);

  const dz = speed * dt;
  if (state !== 'dying') {
    distance += dz;
    runTime += dt;
    score += dz * (power.beer > 0 ? 2 : 1);
  }

  // --- world scroll ---
  pathTex.offset.y += dz / TILE;
  grassTex.offset.y += dz / 6;
  for (const c of chunks) c.position.z += dz;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c.position.z - CHUNK / 2 > DESPAWN_Z + 6) {
      const back = Math.min(...chunks.map((k) => k.position.z)) - CHUNK;
      c.visible = false;
      chunks.splice(i, 1);
      chunkPool.push(c);
      placeChunk(back);
    }
  }
  arch.position.z += dz;
  sinceArch += dz;
  if (arch.position.z > DESPAWN_Z + 5 && sinceArch > 300) {
    arch.position.z = SPAWN_Z - 10;
    sinceArch = 0;
    arch.userData.setText(arch.userData.texts[archIdx++ % arch.userData.texts.length]);
  }

  // --- spawning ---
  if (state !== 'dying') {
    sinceRow += dz;
    if (sinceRow >= rowGap) {
      sinceRow -= rowGap;
      spawnRow(SPAWN_Z + sinceRow);
      rowGap = clamp(26 - distance * 0.004, 17, 26) + rand(-2, 4);
    }
  }

  // --- player movement ---
  if (state === 'run' || state === 'intro') {
    const tx = LANES[lane];
    px = damp(px, tx, 16, dt);
    vy -= GRAVITY * dt;
    py += vy * dt;
    if (py <= 0) {
      py = 0; vy = 0;
      if (!grounded) {
        grounded = true;
        if (queuedSlide) { queuedSlide = false; startSlide(); }
      }
    }
    slideT = Math.max(0, slideT - dt);
    player.position.set(px, py, 0);
    player.rotation.x = 0;
    player.rotation.y = state === 'intro' ? Math.PI * (1 - THREE.MathUtils.smoothstep(introT / 1.0, 0, 1)) : 0;
    player.rotation.z = damp(player.rotation.z, (tx - px) * -0.08, 10, dt);
  }

  // --- timers ---
  invulnT = Math.max(0, invulnT - dt);
  if (injuredT > 0) { injuredT -= dt; if (injuredT <= 0 && state === 'run') toast('Walked it off'); }
  if (power.boost > 0) { power.boost = Math.max(0, power.boost - dt); if (power.boost === 0) Sound.boost(false); }
  if (power.beer > 0) { power.beer = Math.max(0, power.beer - dt); if (power.beer === 0) $('drunkfx').classList.remove('on'); }
  samInner.visible = invulnT > 0 && invulnT < 10 && power.boost <= 0 && !shield ? Math.floor(invulnT * 12) % 2 === 0 : true;

  // --- animation choice ---
  if ((state === 'run' || state === 'intro') && grounded && slideT <= 0) {
    let anim = 'run';
    if (power.boost > 0) anim = 'fast';
    else if (injuredT > 0) anim = 'injured';
    else if (power.beer > 0) anim = 'drunk';
    else if (runTime < 1.4) anim = 'slow';
    else if (speed > 23) anim = 'fast';
    setAnim(anim);
    const a = actions[currentAnim];
    if (a) a.timeScale = clamp(speed / (ANIM_REF_SPEED[currentAnim] || 14), 0.75, 1.5);
  }

  // --- effects ---
  flame.visible = power.boost > 0;
  if (flame.visible) flame.scale.set(1, 1 + Math.random() * 0.6, 1);
  bubble.visible = shield;
  if (shield) bubble.scale.setScalar(1 + Math.sin(elapsed * 6) * 0.04);

  // --- obstacles ---
  const standingTop = slideT > 0 ? 0.8 : 1.75;
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.z += dz + o.vz * dt * (state === 'dying' ? 0 : 1);
    if (o.fly) {
      o.fly.vy -= GRAVITY * 0.6 * dt;
      o.x += o.fly.vx * dt;
      o.mesh.position.y += o.fly.vy * dt;
      o.mesh.rotation.x += o.fly.spin * dt;
      o.mesh.rotation.z += o.fly.spin * 0.7 * dt;
    }
    o.mesh.position.x = o.x;
    o.mesh.position.z = o.z;
    if (o.z - o.len / 2 > DESPAWN_Z || o.mesh.position.y < -20) { recycle(obstacles, i); continue; }
    if (state === 'run' && !o.dead) {
      if (Math.abs(o.z) < o.len / 2 + 0.3 && Math.abs(o.x - px) < o.w / 2 + 0.32) {
        if (py + standingTop > o.bottom && py < o.top) hit(o);
      }
    }
  }

  // --- pickups ---
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.z += dz;
    p.t += dt;
    const m = p.mesh;
    m.position.z = p.z;
    if (p.taken) {
      m.position.y += dt * 6;
      m.scale.multiplyScalar(1 - dt * 6);
      if (m.scale.x < 0.1) { recycle(pickups, i, 'p_'); continue; }
    } else {
      m.rotation.y = p.t * 3;
      m.position.y = p.y + Math.sin(p.t * 3) * 0.08;
      if (state === 'run' && Math.abs(p.z) < 1.0 && Math.abs(p.x - px) < 1.0 && Math.abs((py + 0.9) - p.y) < 1.4) collect(p);
    }
    if (p.z > DESPAWN_Z) recycle(pickups, i, 'p_');
  }

  // --- milestones ---
  if (state === 'run' && milestoneI < MILESTONES.length && distance >= MILESTONES[milestoneI][0]) {
    const [m, txt] = MILESTONES[milestoneI++];
    toast(`${m}m`, txt);
  }

  // --- dying: faceplant ---
  if (state === 'dying') {
    dyingT += dt;
    player.rotation.x = damp(player.rotation.x, -1.5, 8, dt);
    player.position.y = damp(player.position.y, 0.15, 8, dt);
    if (mixer) mixer.timeScale = Math.max(0, 1 - dyingT * 3);
    if (dyingT > 1.3) {
      state = 'over';
      showScreen('over');
      Sound.music('theme', { restart: true });
      if (celebrate) Sound.play('horn');
    }
  }

  // --- camera ---
  const drunk = power.beer > 0 ? 1 : 0;
  const introF = state === 'intro' ? THREE.MathUtils.smoothstep(introT / 1.2, 0, 1) : 1;
  const runCam = new THREE.Vector3(px * 0.75, 2.9 + py * 0.35, 5.6);
  const runLook = new THREE.Vector3(px * 0.85, 1.25 + py * 0.3, -8);
  camera.position.lerpVectors(MENU_CAM, runCam, introF);
  camLook.lerpVectors(MENU_LOOK, runLook, introF);
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    camera.position.x += (Math.random() - 0.5) * shake * 0.8;
    camera.position.y += (Math.random() - 0.5) * shake * 0.8;
  }
  camera.lookAt(camLook);
  if (drunk) camera.rotation.z += Math.sin(elapsed * 1.7) * 0.045;
  const fovWant = baseFov + (power.boost > 0 ? 10 : 0) + drunk * Math.sin(elapsed * 2.3) * 2 + (speed - START_SPEED) * 0.25;
  if (Math.abs(camera.fov - fovWant) > 0.05) {
    camera.fov = damp(camera.fov, fovWant, 4, dt);
    camera.updateProjectionMatrix();
  }

  // --- HUD ---
  setText('score', Math.floor(score).toLocaleString());
  setText('gains', String(gains));
  setText('digits', String(digits));
  $('mult').classList.toggle('hidden', power.beer <= 0);
  updatePowersHud();
}

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  update(dt);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep ~40° of horizontal view on portrait phones so all three lanes fit
  baseFov = camera.aspect < 1
    ? clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / camera.aspect)), 58, 74)
    : 58;
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- boot ----------
camera.position.copy(MENU_CAM);
camera.lookAt(MENU_LOOK);
requestAnimationFrame(frame);
load().then(async () => {
  try { await document.fonts?.ready; } catch { /* fonts are cosmetic */ }
  arch.userData.setText(arch.userData.texts[archIdx++]);
  toMenu();
}).catch((err) => {
  console.error(err);
  $('loadText').textContent = 'Sam tripped while loading. Refresh to try again.';
});

// debug handle for testing in the browser console (local dev only)
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__samrun = { player, samInner, camera, scene, act, get state() { return state; }, get speed() { return speed; }, obstacles, pickups, setGod(v) { invulnT = v ? 1e9 : 0; }, give(type) { collect({ type }); }, step(n = 1) { for (let i = 0; i < n; i++) update(1 / 60); renderer.render(scene, camera); } };
