import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Sound } from './audio.js';
import { fetchTop, cleanName, NAME_PATTERN } from './leaderboard.js';
import { Account } from './account.js';
import {
  SKINS, skinById, MissionRun, freshMissions, validMissions, missionText, setReward, dailyReady, nextDailyBonus,
} from './progress.js';
import {
  LANE_W, LANES, PATH_W, GROUND_LEN, CHUNK, ROOF_Y, RAMP_LEN,
  makePathTexture, makeGrassTexture, makeSky, buildChunk, buildArch, OBSTACLES, PICKUPS,
  buildShadesModel, heartTex, sparkleTex,
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
const POWER_TIME = { beer: 9, boost: 5, shades: 10 };
const MAGNET_RANGE = 10; // how far ahead the Sexy Mode shades pull dumbbells from
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
const SEXY_QUIPS = ['They can’t resist him', 'Aura +1000', 'Dumbbells are throwing themselves at him', 'Too sexy to lift a finger', 'Blue lenses, bluer steel'];
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

// Sexy Mode shades: worn on Sam's face, a pink aura, and hearts floating off him
const aura = new THREE.Mesh(
  new THREE.SphereGeometry(1.35, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0xff6fb5, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
);
aura.position.y = 0.95;
aura.visible = false;
player.add(aura);
const wornShades = buildShadesModel();
wornShades.visible = false;
const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkleTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
glint.position.set(0.045, 0.012, 0.012);
glint.scale.setScalar(0.05);
wornShades.add(glint);

const heartMat = new THREE.SpriteMaterial({ map: heartTex(), transparent: true, depthWrite: false });
const hearts = [];
function emitHeart(x, y, z, size = 0.3) {
  let h = hearts.find((k) => !k.sprite.visible);
  if (!h) {
    h = { sprite: new THREE.Sprite(heartMat.clone()) };
    scene.add(h.sprite);
    hearts.push(h);
  }
  h.sprite.visible = true;
  h.sprite.position.set(x, y, z);
  h.size = size;
  h.t = 0;
  h.life = rand(0.7, 1.1);
  h.vx = rand(-0.8, 0.8);
  h.vy = rand(1.2, 2.2);
}
function updateHearts(dt, dz) {
  for (const h of hearts) {
    if (!h.sprite.visible) continue;
    h.t += dt;
    const f = h.t / h.life;
    if (f >= 1) { h.sprite.visible = false; continue; }
    h.sprite.position.x += h.vx * dt;
    h.sprite.position.y += h.vy * dt;
    h.sprite.position.z += dz * 0.08; // mostly ride along with Sam instead of flying at the camera
    h.sprite.scale.setScalar(h.size * Math.min(1, f * 5) * (1 + Math.sin(h.t * 14) * 0.08));
    h.sprite.material.opacity = 1 - f * f;
  }
}

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
// Animations load once and are shared by every skin (all skins use the same Mixamo rig).
// A skin's model only downloads when it's equipped or previewed in the shop.
const ANIM_FILES = [
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
const fbx = new FBXLoader();
const clips = {};
const skinModels = {};
const skinLoads = {};
let shownSkin = null;
let equippedSkin = store.get('samrun.equipped', 'sam');

function loadFBX(url, onProgress) {
  return new Promise((resolve, reject) => fbx.load(url, resolve, onProgress, reject));
}

function prepModel(model) {
  model.traverse((o) => {
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
  const box = new THREE.Box3().setFromObject(model);
  model.scale.multiplyScalar(SAM_HEIGHT / (box.max.y - box.min.y));
  // Ground the model using an animated pose — the T-pose rest skeleton sits at a different hip height.
  const m = new THREE.AnimationMixer(model);
  m.clipAction(clips.run).play();
  m.update(0);
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isSkinnedMesh) o.computeBoundingBox(); });
  model.position.y -= new THREE.Box3().setFromObject(model).min.y;
  m.stopAllAction();
  m.uncacheRoot(model);
  // Sexy Mode shades anchor on the head bone, sized in world units whatever the model's scale.
  model.updateMatrixWorld(true);
  const head = model.getObjectByName('mixamorigHead') || model.getObjectByName('mixamorig:Head');
  if (head) {
    const ws = head.getWorldScale(new THREE.Vector3()).x;
    const anchor = new THREE.Group();
    anchor.name = 'shadesAnchor';
    anchor.scale.setScalar(1 / ws);
    anchor.position.set(0, 0.085 / ws, 0.095 / ws);
    head.add(anchor);
  }
  return model;
}

function loadSkin(id, onProgress) {
  return (skinLoads[id] ||= loadFBX(skinById(id).file, onProgress)
    .then((model) => (skinModels[id] = prepModel(model)))
    .catch((err) => { delete skinLoads[id]; throw err; }));
}

// Swap the visible character to a loaded skin, keeping whatever animation was playing.
function showSkin(id) {
  const model = skinModels[id];
  if (!model || shownSkin === id) return;
  const prev = currentAnim;
  if (mixer) mixer.stopAllAction();
  if (sam) samInner.remove(sam);
  sam = model;
  samInner.add(sam);
  shownSkin = id;
  mixer = new THREE.AnimationMixer(sam);
  for (const [key, clip] of Object.entries(clips)) {
    const a = mixer.clipAction(clip);
    if (key === 'jump' || key === 'slide') {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    actions[key] = a;
  }
  currentAnim = null;
  setAnim(prev || 'dance', 0);
  sam.getObjectByName('shadesAnchor')?.add(wornShades);
}

async function load() {
  const total = ANIM_FILES.reduce((a, f) => a + f[2], 0) + 12.8e6;
  const loaded = {};
  let lineI = 0;
  const lineTimer = setInterval(() => { $('loadText').textContent = LOAD_LINES[++lineI % LOAD_LINES.length]; }, 1400);
  const bump = () => {
    const sum = Object.values(loaded).reduce((a, b) => a + b, 0);
    $('barFill').style.width = `${Math.min(97, (sum / total) * 100)}%`;
  };
  const anims = await Promise.all(ANIM_FILES.map(([key, url, size]) => loadFBX(url, (e) => { loaded[key] = Math.min(e.loaded, size); bump(); })
    .then((o) => { loaded[key] = size; bump(); return [key, o]; })));
  for (const [key, o] of anims) {
    const clip = o.animations[0];
    if (!clip) continue;
    if (key !== 'dance') inPlace(clip, key === 'jump');
    clips[key] = clip;
  }
  if (!SKINS.some((k) => k.id === equippedSkin)) equippedSkin = 'sam';
  const skinProgress = (e) => { loaded.skin = Math.min(e.loaded, 12.8e6); bump(); };
  try { await loadSkin(equippedSkin, skinProgress); } catch { equippedSkin = 'sam'; await loadSkin('sam', skinProgress); }
  clearInterval(lineTimer);
  showSkin(equippedSkin);
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
const power = { beer: 0, boost: 0, shades: 0 };
let ground = 0; // height of whatever Sam is standing on (0, a ramp, or a bus roof)
// per-run counters for missions
let run = {};
let missions = loadLocalMissions();
let missionRun = null;
let lastResult = null; // the finished run, kept so a guest can bank it after signing in
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

function loadLocalMissions() {
  const m = store.get('samrun.missions', null);
  return validMissions(m) ? m : freshMissions();
}

function spawnObstacle(type, x, z, vz = 0) {
  const def = OBSTACLES[type];
  const pool = (pools[type] ||= []);
  const mesh = pool.pop() || def.build();
  if (!mesh.parent) scene.add(mesh);
  mesh.visible = true;
  mesh.position.set(x, 0, z);
  mesh.rotation.set(0, 0, 0);
  const e = { type, mesh, x, z, vz, w: def.w, len: def.len, bottom: def.bottom, top: def.top, ramp: !!def.ramp, dead: false, fly: null, passed: false, used: false };
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
  const e = { type, mesh, x, z, y: y ?? def.y, taken: false, rizzed: false, t: Math.random() * 6 };
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

function spawnPower(laneI, z, y) {
  const r = Math.random();
  const type = r < 0.22 ? 'beer' : r < 0.42 ? 'boost' : r < 0.62 ? 'shake' : r < 0.82 ? 'shades' : 'phone';
  spawnPickup(type, LANES[laneI], z, y);
}

// A parked bus you can run up onto. zFront is where the ramp's low end starts.
function busWithRamp(laneI, zFront, cars = 1) {
  spawnObstacle('ramp', LANES[laneI], zFront - RAMP_LEN / 2);
  for (let k = 0; k < cars; k++) spawnObstacle('bus', LANES[laneI], zFront - RAMP_LEN - 5 - k * 10.6);
  const roofLen = cars * 10.6;
  // dumbbells up the ramp and along the roof
  for (let k = 0; k < 3; k++) spawnPickup('gains', LANES[laneI], zFront - 1 - k * 2, 0.9 + (1 + k * 2) / RAMP_LEN * ROOF_Y);
  for (let d = 1; d < roofLen - 1; d += 2.3) spawnPickup('gains', LANES[laneI], zFront - RAMP_LEN - d, ROOF_Y + 0.9);
  return RAMP_LEN + roofLen;
}

function spawnRow(z) {
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
  const small = ['slug', 'turkey', 'log', 'banner'];
  const d = distance;
  let r = Math.random();
  if (rowsSinceBus < 1 && r < 0.28) r = 0.28 + Math.random() * 0.72; // no back-to-back bus rows
  let free = [];
  let bus = false;

  let extra = 0; // how much longer than a normal row this pattern runs
  if (d < 140) {
    const t = pick(['slug', 'turkey', 'log', 'banner']);
    spawnObstacle(t, LANES[lanes[0]], z);
    free = [lanes[1], lanes[2]];
  } else if (r < 0.16) {
    // one bus + one small; parked buses usually get a ramp
    const oncoming = d > 500 && rowsSinceBus >= 5 && Math.random() < 0.35;
    bus = true;
    if (!oncoming && Math.random() < 0.5) extra = busWithRamp(lanes[0], z + 4) - 10;
    else spawnObstacle('bus', LANES[lanes[0]], z - 5, oncoming ? 7 : 0);
    spawnObstacle(pick(small), LANES[lanes[1]], z);
    free = [lanes[2]];
  } else if (r < 0.22 && rowsSinceBus >= 1) {
    // bus train: 2-3 parked buses end to end behind a ramp, with a parked bus beside it
    bus = true;
    const cars = d > 700 && Math.random() < 0.5 ? 3 : 2;
    extra = busWithRamp(lanes[0], z + 4, cars) - 10;
    spawnObstacle('bus', LANES[lanes[1]], z - RAMP_LEN - 2 - rand(0, 6));
    if (Math.random() < 0.3) spawnPower(lanes[0], z - RAMP_LEN - cars * 10.6 + 3, ROOF_Y + 1);
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
  sinceRow -= extra; // leave room so the next row doesn't land on top of a long bus train

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
  power.shades = 0; ground = 0; camGround = 0;
  run = { gains: 0, distance: 0, jumps: 0, banners: 0, roof: 0, ramps: 0, digits: 0, smash: 0, shades: 0, rizzGains: 0, clean: 0, drunkGains: 0, sinceHit: 0 };
  missionRun = new MissionRun(missions);
  lastResult = null;
  wornShades.visible = false;
  aura.visible = false;
  for (const h of hearts) h.sprite.visible = false;
  player.position.set(0, 0, 0);
  player.rotation.set(0, 0, 0);
  samInner.visible = true;
  if (mixer) mixer.timeScale = 1;
  // pre-populate the road ahead
  for (let z = -45; z > SPAWN_Z; z -= 24) { sinceRow = 0; spawnRow(z); }
  sinceRow = 0;
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
  if (power.shades > 0) items.push(['shades', power.shades / POWER_TIME.shades]);
  if (shield) items.push(['shake', 1]);
  if (injuredT > 0) items.push(['bandage', injuredT / INJURY_TIME]);
  const key = items.map((i) => i[0] + Math.round(i[1] * 40)).join();
  if (lastHud.powers === key) return;
  lastHud.powers = key;
  $('powers').innerHTML = items.map(([ico, f]) => `<div class="power">${icon(ico)}<div class="t"><i style="width:${(f * 100).toFixed(0)}%"></i></div></div>`).join('');
}

function showScreen(id) {
  for (const s of ['loading', 'menu', 'pause', 'over', 'board', 'missions', 'account', 'shop']) $(s).classList.toggle('hidden', s !== id);
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
      run.jumps++;
      Sound.play('jump');
      playOnce('jump', actions.jump ? actions.jump.getClip().duration / (2 * JUMP_V / GRAVITY) : 1);
    }
  } else if (a === 'down') {
    if (!grounded) { vy = -24; queuedSlide = true; }
    else startSlide();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || ['board', 'missions', 'account', 'shop'].some((id) => !$(id).classList.contains('hidden'))) return;
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
  if (state === 'run' || state === 'intro') { prevState = state; state = 'paused'; renderMissions($('pauseMissions')); showScreen('pause'); Sound.music(null); Sound.boost(false); }
  else if (state === 'paused') { state = prevState || 'run'; showScreen(null); clock.getDelta(); Sound.music('run'); if (power.boost > 0) Sound.boost(true); }
}

// ---------- leaderboard ----------
let boardReturn = 'menu';

function setSubmitMsg(text, err = false) {
  const el = $('submitMsg');
  el.textContent = text;
  el.classList.toggle('err', err);
}

async function openBoard(from) {
  boardReturn = from;
  showScreen('board');
  const myName = Account.profile?.name;
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

// ---------- missions ----------
function saveMissions() {
  store.set('samrun.missions', missions);
}

function renderMissions(el) {
  el.innerHTML = missions.list.map((m, i) => {
    const done = m.prog >= m.target;
    const f = Math.min(1, m.prog / m.target);
    return `<div class="mission${done ? ' done' : ''}">${done ? icon('check') : `<span class="num">${i + 1}</span>`}
      <div><div class="mt">${missionText(m)}</div><div class="bar2"><i style="width:${(f * 100).toFixed(0)}%"></i></div>
      <div class="mp">${done ? 'Done!' : `${m.prog.toLocaleString()} / ${m.target.toLocaleString()}`}</div></div></div>`;
  }).join('');
}

function openMissions() {
  renderMissions($('missionList'));
  $('missionSet').textContent = `Set ${missions.set + 1}`;
  const allDone = missions.list.every((m) => m.prog >= m.target);
  $('missionReward').textContent = allDone
    ? (Account.signedIn ? `Set complete! +${setReward(missions.set)} on your next run` : `Set complete! Sign in to bank +${setReward(missions.set)}`)
    : `Finish all 3 for +${setReward(missions.set).toLocaleString()} dumbbells`;
  const p = Account.profile;
  $('missionDaily').textContent = !p ? 'Sign in for a daily bonus streak'
    : dailyReady(p) ? `Daily bonus ready: +${nextDailyBonus(p)} on your next run`
      : `Day ${p.dailyStreak} streak. Come back tomorrow for +${nextDailyBonus({ ...p, dailyDay: todayMinus(1) })}`;
  showScreen('missions');
}
const todayMinus = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

$('missionsBtn').addEventListener('click', openMissions);
$('missionsBack').addEventListener('click', () => showScreen('menu'));

// ---------- account ----------
let accountReturn = 'menu';
let accountMode = 'create';
let nameCheckTimer = 0;

function setAcctMsg(text, err = false) {
  $('acctMsg').textContent = text;
  $('acctMsg').classList.toggle('err', err);
}

function setAccountMode(mode) {
  accountMode = mode;
  $('tabCreate').classList.toggle('on', mode === 'create');
  $('tabSignIn').classList.toggle('on', mode === 'signin');
  $('acctSubmit').textContent = mode === 'create' ? 'CREATE ACCOUNT' : 'SIGN IN';
  $('acctPass').autocomplete = mode === 'create' ? 'new-password' : 'current-password';
  $('acctHint').textContent = mode === 'create' ? 'Pick a password you’ll remember. There’s no email reset.' : '';
  $('acctHint').classList.remove('err');
  setAcctMsg('');
  if (mode === 'create') checkName();
}

function openAccount(from, mode = 'create') {
  accountReturn = from;
  const signedIn = Account.signedIn;
  $('accountGuest').classList.toggle('hidden', signedIn);
  $('accountUser').classList.toggle('hidden', !signedIn);
  $('accountTitle').textContent = signedIn ? 'ACCOUNT' : mode === 'create' ? 'JOIN UP' : 'WELCOME BACK';
  if (signedIn) $('acctWho').textContent = `Signed in as ${Account.profile.name}`;
  else { $('acctPass').value = ''; setAccountMode(mode); }
  showScreen('account');
}

function checkName() {
  clearTimeout(nameCheckTimer);
  const name = cleanName($('acctName').value).trim();
  const hint = $('acctHint');
  if (accountMode !== 'create' || !name) return;
  nameCheckTimer = setTimeout(async () => {
    try {
      const st = await Account.nameStatus(name);
      if (cleanName($('acctName').value).trim() !== name || accountMode !== 'create') return;
      if (st.taken) { hint.textContent = `${name} is taken. Is it you? Sign in instead.`; hint.classList.add('err'); }
      else if (st.legacy != null) { hint.textContent = `${name} is on the board with ${st.legacy.toLocaleString()}. Creating this account claims that score.`; hint.classList.remove('err'); }
      else { hint.textContent = 'Name’s free. Pick a password you’ll remember.'; hint.classList.remove('err'); }
    } catch { /* offline: the submit will say so */ }
  }, 350);
}

$('acctName').addEventListener('input', (e) => {
  const v = cleanName(e.target.value);
  if (v !== e.target.value) e.target.value = v;
  checkName();
});
$('tabCreate').addEventListener('click', () => { setAccountMode('create'); $('accountTitle').textContent = 'JOIN UP'; });
$('tabSignIn').addEventListener('click', () => { setAccountMode('signin'); $('accountTitle').textContent = 'WELCOME BACK'; });

const ACCOUNT_ERRORS = {
  'name taken': 'That name is taken. Sign in if it’s you.',
  'invalid name': 'Letters, numbers and spaces only (12 max).',
  'invalid password': 'Password needs at least 4 characters.',
  'wrong name or password': 'Wrong name or password.',
  'too many tries': 'Too many tries. Wait 5 minutes.',
};

$('accountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = cleanName($('acctName').value).trim();
  const pass = $('acctPass').value;
  if (!name || !NAME_PATTERN.test(name)) { setAcctMsg('Type a name first', true); return; }
  if (pass.length < 4) { setAcctMsg('Password needs at least 4 characters.', true); return; }
  document.activeElement?.blur();
  $('acctSubmit').disabled = true;
  setAcctMsg(accountMode === 'create' ? 'Creating…' : 'Signing in…');
  try {
    if (accountMode === 'create') {
      const r = await Account.signUp(name, pass);
      // bring the guest's mission progress into the new account
      Account.saveMissions(missions);
      if (r.claimed != null) toast('SCORE CLAIMED', `${r.claimed.toLocaleString()} is yours + ${r.welcome.toLocaleString()} dumbbells`);
      else toast(`WELCOME ${r.profile.name}`);
    } else {
      const r = await Account.signIn(name, pass);
      adoptServerMissions(r.profile);
      toast(`WELCOME BACK ${r.profile.name}`);
    }
    $('acctPass').value = '';
    setAcctMsg('');
    if (accountReturn === 'over' && lastResult && !lastResult.banked) {
      showScreen('over');
      bankRun();
    } else showScreen(accountReturn);
  } catch (err) {
    const m = String(err.message || '');
    setAcctMsg(ACCOUNT_ERRORS[m] || 'Couldn’t reach the server. Check your connection.', true);
  } finally {
    $('acctSubmit').disabled = false;
  }
});

$('signOutBtn').addEventListener('click', async () => {
  await Account.signOut();
  showScreen(accountReturn === 'over' ? 'over' : 'menu');
});
$('accountBack').addEventListener('click', () => showScreen(accountReturn));
$('accountBtn').addEventListener('click', () => openAccount('menu', 'create'));
$('saveCreateBtn').addEventListener('click', () => openAccount('over', 'create'));
$('saveSignInBtn').addEventListener('click', () => openAccount('over', 'signin'));

// Signed in on another device? Their missions live on the server.
function adoptServerMissions(profile) {
  if (validMissions(profile?.missions)) { missions = profile.missions; saveMissions(); }
  else Account.saveMissions(missions);
}

function syncAccountUi() {
  const p = Account.profile;
  for (const el of document.querySelectorAll('.walletAmt')) el.textContent = (p?.coins ?? 0).toLocaleString();
  for (const el of document.querySelectorAll('.wallet')) el.classList.toggle('hidden', !p);
  $('accountLabel').textContent = p ? p.name : 'SIGN IN';
  if (p) best = Math.max(best, p.best || 0);
  $('bestLine').textContent = best ? `Personal record: ${best.toLocaleString()}` : 'Cowell’s finest. Allegedly.';
  const daily = p && dailyReady(p);
  $('dailyLine').classList.toggle('hidden', !daily);
  if (daily) $('dailyLine').textContent = `Daily bonus ready: +${nextDailyBonus(p)} dumbbells`;
  $('missionsDot').classList.toggle('hidden', !missions.list.every((m) => m.prog >= m.target));
  // wear the equipped skin (guests are always plain Sam)
  const want = p?.equipped || 'sam';
  if (want !== equippedSkin) setEquipped(want);
}
Account.onChange(syncAccountUi);

function setEquipped(id) {
  equippedSkin = id;
  store.set('samrun.equipped', id);
  if (!clips.run) return; // still booting: load() picks up equippedSkin itself
  if (state === 'menu' && !$('shop').classList.contains('hidden')) return; // the shop controls the preview
  loadSkin(id).then(() => { if (equippedSkin === id) showSkin(id); }).catch(() => {});
}

// ---------- end of run: bank dumbbells + post the score ----------
async function bankRun() {
  const r = lastResult;
  if (!r || r.banked || r.banking) return;
  r.banking = true;
  const before = JSON.parse(JSON.stringify(missions));
  const bonus = new MissionRun(missions).finish(); // advances the set if it's complete
  $('saveCard').classList.add('hidden');
  $('bankBox').classList.remove('hidden');
  $('bankLine').innerHTML = `${icon('dumbbell')} Banking…`;
  $('bankExtra').textContent = '';
  setSubmitMsg('');
  try {
    const res = await Account.finishRun(r, bonus, missions);
    r.banked = true;
    saveMissions();
    $('bankLine').innerHTML = `${icon('dumbbell')} +${res.banked.toLocaleString()} BANKED`;
    const extra = [];
    if (res.bonus) extra.push(`Mission set +${res.bonus.toLocaleString()}`);
    if (res.daily) extra.push(`Day ${res.streak} streak +${res.daily.toLocaleString()}`);
    extra.push(`Wallet: ${res.profile.coins.toLocaleString()}`);
    $('bankExtra').textContent = extra.join(' · ');
    setSubmitMsg(res.improved ? `You're #${res.rank} on the board!` : `Your best is still ${res.best.toLocaleString()} (#${res.rank})`);
  } catch (err) {
    missions = before;
    saveMissions();
    const m = String(err.message || '');
    $('bankLine').innerHTML = `${icon('dumbbell')} Not banked`;
    if (m.includes('not signed in')) { showGuestSave(); setSubmitMsg('Signed out. Sign in again to save this run.', true); }
    else setSubmitMsg(m.includes('slow down') ? 'Slow down, try again in a sec' : m.includes('invalid run') ? 'That run looks sus. Not posted.' : 'Couldn’t save the run. Check your connection.', true);
  } finally {
    r.banking = false;
  }
}

function showGuestSave() {
  const r = lastResult;
  $('bankBox').classList.add('hidden');
  $('saveCard').classList.remove('hidden');
  const setDone = missions.list.every((m) => m.prog >= m.target);
  $('saveText').innerHTML = `Create an account to put <b>${Math.floor(r.score).toLocaleString()}</b> on the leaderboard and bank <b>${r.gains.toLocaleString()}</b> dumbbells`
    + (setDone ? ` + <b>${setReward(missions.set).toLocaleString()}</b> for your mission set` : '')
    + '. Spend them on skins.';
}

// ---------- skins shop ----------
let shopI = 0;
let shopConfirm = false;

function openShop() {
  shopI = Math.max(0, SKINS.findIndex((k) => k.id === equippedSkin));
  shopConfirm = false;
  showScreen('shop');
  $('shopMsg').textContent = '';
  renderShop();
  previewSkin();
}

function renderShop() {
  const skin = SKINS[shopI];
  const p = Account.profile;
  const owned = skin.price === 0 || !!p?.skins?.includes(skin.id);
  const equipped = equippedSkin === skin.id;
  $('skinName').textContent = skin.name;
  $('skinTag').textContent = skin.tag;
  $('skinDots').innerHTML = SKINS.map((k, i) => `<i class="${i === shopI ? 'on' : ''}${k.price === 0 || p?.skins?.includes(k.id) ? ' own' : ''}"></i>`).join('');
  const btn = $('skinAction');
  btn.disabled = false;
  if (equipped) { btn.textContent = 'EQUIPPED'; btn.disabled = true; }
  else if (owned) btn.textContent = 'EQUIP';
  else if (!p) btn.innerHTML = `SIGN IN TO BUY · ${icon('dumbbell')} ${skin.price.toLocaleString()}`;
  else if (shopConfirm) btn.innerHTML = `TAP TO CONFIRM · ${icon('dumbbell')} ${skin.price.toLocaleString()}`;
  else btn.innerHTML = `BUY · ${icon('dumbbell')} ${skin.price.toLocaleString()}`;
}

async function previewSkin() {
  const id = SKINS[shopI].id;
  if (!skinModels[id]) $('shopSpin').classList.remove('hidden');
  try {
    await loadSkin(id);
    if (SKINS[shopI].id === id && !$('shop').classList.contains('hidden')) showSkin(id);
  } catch {
    if (SKINS[shopI].id === id) $('shopMsg').textContent = 'Couldn’t load this skin. Check your connection.';
  }
  if (SKINS[shopI].id === id) $('shopSpin').classList.add('hidden');
}

function shopStep(d) {
  shopI = (shopI + d + SKINS.length) % SKINS.length;
  shopConfirm = false;
  $('shopMsg').textContent = '';
  renderShop();
  previewSkin();
}

$('shopBtn').addEventListener('click', openShop);
$('skinPrev').addEventListener('click', () => shopStep(-1));
$('skinNext').addEventListener('click', () => shopStep(1));
$('shopBack').addEventListener('click', () => {
  showScreen('menu');
  loadSkin(equippedSkin).then(() => showSkin(equippedSkin)).catch(() => {});
});
$('skinAction').addEventListener('click', async () => {
  const skin = SKINS[shopI];
  const p = Account.profile;
  const owned = skin.price === 0 || !!p?.skins?.includes(skin.id);
  if (!p && !owned) { openAccount('shop', 'create'); return; }
  const btn = $('skinAction');
  try {
    if (owned) {
      btn.disabled = true;
      if (p) await Account.equip(skin.id);
      else equippedSkin = skin.id;
      store.set('samrun.equipped', skin.id);
      equippedSkin = skin.id;
      toast(`${skin.name.toUpperCase()}`, 'Equipped');
    } else if (!shopConfirm) {
      if (p.coins < skin.price) { $('shopMsg').textContent = `Need ${(skin.price - p.coins).toLocaleString()} more dumbbells. Keep running.`; return; }
      shopConfirm = true;
    } else {
      btn.disabled = true;
      await Account.buy(skin.id);
      equippedSkin = skin.id;
      store.set('samrun.equipped', skin.id);
      shopConfirm = false;
      Sound.play('horn', { vol: 0.6 });
      toast(`${skin.name.toUpperCase()}`, 'Unlocked and equipped');
    }
  } catch (err) {
    const m = String(err.message || '');
    $('shopMsg').textContent = m.includes('not enough') ? 'Not enough dumbbells.' : m.includes('not signed in') ? 'Signed out. Sign in again.' : 'Couldn’t reach the server.';
    shopConfirm = false;
  }
  renderShop();
});

// ---------- flow ----------
const MENU_CAM = new THREE.Vector3(0.7, 1.25, 4.0);
const MENU_LOOK = new THREE.Vector3(0, 0.55, 0);
const camLook = new THREE.Vector3();
let camGround = 0;

function toMenu() {
  state = 'menu';
  resetRun();
  for (let i = obstacles.length - 1; i >= 0; i--) recycle(obstacles, i);
  for (let i = pickups.length - 1; i >= 0; i--) recycle(pickups, i, 'p_');
  setAnim('dance', 0.4);
  player.rotation.y = Math.PI; // face the camera while dancing
  $('drunkfx').classList.remove('on');
  Sound.boost(false);
  Sound.music('theme');
  syncAccountUi();
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
  $('drunkfx').classList.remove('on');
  missionRun?.update(run);
  saveMissions();
  lastResult = { score, distance, gains, digits, smashes, duration: runTime, banked: false };
  setSubmitMsg('');
  if (Account.signedIn) bankRun();
  else showGuestSave();
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
  run.sinceHit = 0;
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
  if (power.boost > 0) run.smash++;
  o.fly = { vy: rand(7, 10), vx: (o.x >= px ? 1 : -1) * rand(4, 8), spin: rand(-8, 8) };
  score += 50 * (power.beer > 0 ? 2 : 1);
  Sound.play('hit', { vol: 0.6, rate: 1.3 });
  shake = 0.2;
}

function collect(p) {
  p.taken = true;
  const mult = power.beer > 0 ? 2 : 1;
  switch (p.type) {
    case 'gains':
      gains++; run.gains++; score += 10 * mult;
      if (power.beer > 0) run.drunkGains++;
      if (p.rizzed) { run.rizzGains++; emitHeart(px + rand(-0.3, 0.3), py + 1.6, 0.2, 0.22); }
      Sound.play('gains', { rate: p.rizzed ? rand(1.15, 1.3) : rand(0.95, 1.08) });
      break;
    case 'beer': power.beer = POWER_TIME.beer; Sound.play('drink'); toast(`${icon('cup')} DRUNK MODE`, '2x points'); $('drunkfx').classList.add('on'); break;
    case 'boost': power.boost = POWER_TIME.boost; Sound.boost(true); toast(`${icon('boost')} SUPERSONIC`, 'Smash through everything'); break;
    case 'shake':
      Sound.play('gulp');
      if (injuredT > 0) { injuredT = 0; toast(`${icon('shake')} PROTEIN SHAKE`, 'Fully healed. Gains restored'); }
      else { shield = true; toast(`${icon('shake')} PROTEIN SHAKE`, 'Shield up'); }
      break;
    case 'shades':
      power.shades = POWER_TIME.shades; run.shades++;
      Sound.play('phone', { rate: 1.25, vol: 0.7 });
      toast(`${icon('shades')} SEXY MODE`, pick(SEXY_QUIPS));
      for (let k = 0; k < 6; k++) emitHeart(px + rand(-0.6, 0.6), py + rand(1, 2), rand(-0.3, 0.3), 0.3);
      break;
    case 'phone': run.digits++; digits++; score += 250 * mult; Sound.play('phone'); toast(`${icon('phone')} ${pick(PHONE_QUIPS)}`, `+${250 * mult}`); break;
  }
}

// Height of the surface under Sam: a ramp's slope or a bus roof, else the path.
// Surfaces only count when Sam is already near or above them, so running into
// the front of a bus from the ground is still a crash, not a teleport onto the roof.
function groundAt(x, y) {
  let g = 0;
  for (const o of obstacles) {
    if (o.dead || o.fly || !(o.ramp || o.type === 'bus')) continue;
    if (Math.abs(o.x - x) > o.w / 2 + 0.05 || Math.abs(o.z) > o.len / 2) continue;
    let h;
    if (o.ramp) {
      h = clamp((RAMP_LEN / 2 + o.z) / RAMP_LEN, 0, 1) * ROOF_Y;
      if (y < h - 1.3) continue;
      if (!o.used && state === 'run') { o.used = true; run.ramps++; }
    } else {
      h = ROOF_Y;
      if (y < h - 0.7) continue;
    }
    g = Math.max(g, h);
  }
  return g;
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
    if (state === 'run') {
      run.distance = distance;
      run.sinceHit += dz;
      run.clean = Math.max(run.clean, run.sinceHit);
    }
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
    ground = groundAt(px, py);
    if (py <= ground) {
      py = ground; vy = 0;
      if (!grounded) {
        grounded = true;
        if (queuedSlide) { queuedSlide = false; startSlide(); }
      }
    } else if (grounded && py > ground + 0.05) {
      grounded = false; // ran off the back of a bus or stepped off a roof
    }
    if (grounded && ground >= ROOF_Y - 0.01 && state === 'run') run.roof += dz;
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
  if (power.shades > 0) power.shades = Math.max(0, power.shades - dt);
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
  const rizz = power.shades > 0 && state !== 'dying';
  wornShades.visible = rizz;
  aura.visible = rizz;
  if (rizz) {
    const pulse = Math.sin(elapsed * 5);
    aura.scale.setScalar(1 + pulse * 0.06);
    aura.material.opacity = 0.08 + (pulse + 1) * 0.03;
    // warn before it runs out, like the other timers
    if (power.shades < 1.5) aura.visible = Math.floor(elapsed * 8) % 2 === 0;
    glint.material.opacity = Math.max(0, Math.sin(elapsed * 3.2)) ** 6;
    if (Math.random() < dt * 5) emitHeart(px + rand(-0.5, 0.5), py + rand(1.2, 1.9), rand(-0.2, 0.3), rand(0.18, 0.3));
  }
  updateHearts(dt, dz);

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
    if (state === 'run' && !o.dead && !o.passed && o.z > o.len / 2 + 0.3) {
      o.passed = true;
      // the only way past a banner in your lane is under it
      if ((o.type === 'banner' || o.type === 'bannerWide') && Math.abs(o.x - px) < o.w / 2 + 0.32) run.banners++;
    }
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
    if (!p.taken && power.shades > 0 && state === 'run' && p.type === 'gains' && p.z > -MAGNET_RANGE && p.z < 1.5) {
      // they can't resist: swoop in toward Sam on a curve
      p.rizzed = true;
      const k = 1 - Math.exp(-9 * dt);
      p.x += (px - p.x) * k;
      p.y += (py + 0.9 - p.y) * k;
      p.z += (0 - p.z) * k * 0.9;
    }
    m.position.x = p.x;
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

  // --- missions ---
  if (state === 'run' && missionRun) {
    for (const i of missionRun.update(run)) {
      toast('MISSION COMPLETE', missionText(missions.list[i]));
      Sound.play('phone', { rate: 1.4, vol: 0.6 });
      if (missionRun.allDone) setTimeout(() => { if (state === 'run') toast('SET COMPLETE', `+${setReward(missions.set)} dumbbells when you finish`); }, 1800);
    }
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
    player.position.y = damp(player.position.y, ground + 0.15, 8, dt);
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
  // follow Sam up onto bus roofs smoothly, but only lightly track jumps
  camGround = damp(camGround, ground, 4, dt);
  const air = py - camGround;
  const runCam = new THREE.Vector3(px * 0.75, 2.9 + camGround * 0.85 + air * 0.35, 5.6);
  const runLook = new THREE.Vector3(px * 0.85, 1.25 + camGround * 0.8 + air * 0.3, -8);
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
const restored = Account.restore(); // runs alongside the model download
load().then(async () => {
  try { await document.fonts?.ready; } catch { /* fonts are cosmetic */ }
  if (await restored) adoptServerMissions(Account.profile);
  arch.userData.setText(arch.userData.texts[archIdx++]);
  toMenu();
}).catch((err) => {
  console.error(err);
  $('loadText').textContent = 'Sam tripped while loading. Refresh to try again.';
});

// debug handle for testing in the browser console (local dev only)
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__samrun = { player, samInner, camera, scene, act, get state() { return state; }, get speed() { return speed; }, obstacles, pickups, setGod(v) { invulnT = v ? 1e9 : 0; }, give(type) { collect({ type }); }, get run() { return run; }, get missions() { return missions; }, Account, get ground() { return ground; }, get py() { return py; }, ramp(cars = 1) { busWithRamp(lane, -20, cars); }, step(n = 1) { for (let i = 0; i < n; i++) update(1 / 60); renderer.render(scene, camera); } };
