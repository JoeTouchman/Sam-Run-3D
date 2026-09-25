// Procedural low-poly UCSC: redwoods, Cowell stucco buildings, the path, obstacles and pickups.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LANE_W = 2.2;
export const LANES = [-LANE_W, 0, LANE_W];
export const PATH_W = LANE_W * 3 + 1.2;
export const GROUND_LEN = 320;
export const CHUNK = 40;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---------- vertex-colored geometry helpers (one draw call per object) ----------
export const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function part(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return paint(geo, hex);
}

function merged(parts, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(parts), vcMat);
  m.castShadow = shadow;
  m.receiveShadow = false;
  return m;
}

// ---------- canvas textures ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makePathTexture() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8e857a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const v = 110 + Math.random() * 60;
      g.fillStyle = `rgba(${v},${v - 8},${v - 18},.5)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // darker edges
    const edge = w * (0.6 / PATH_W);
    g.fillStyle = 'rgba(60,45,35,.35)';
    g.fillRect(0, 0, edge, h);
    g.fillRect(w - edge, 0, edge, h);
    // dashed lane dividers
    g.fillStyle = 'rgba(255,248,230,.85)';
    for (const lx of [-LANE_W / 2, LANE_W / 2]) {
      const u = (0.5 + lx / PATH_W) * w;
      g.fillRect(u - 3, 0, 6, h * 0.55);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeGrassTexture() {
  const t = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5f8a3c';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const s = Math.random();
      g.fillStyle = s < 0.5 ? 'rgba(70,110,45,.6)' : s < 0.85 ? 'rgba(120,150,70,.5)' : 'rgba(150,120,70,.4)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function textTex(text, { w = 512, h = 128, bg = '#1b1030', fg = '#ffc933', border = '#ff7a1a', font = 'Luckiest Guy' } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = border;
    g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = h * 0.55;
    g.font = `${size}px "${font}", Impact, sans-serif`;
    while (g.measureText(text).width > w * 0.88 && size > 10) { size -= 2; g.font = `${size}px "${font}", Impact, sans-serif`; }
    g.fillText(text, w / 2, h / 2 + size * 0.06);
  });
}

// ---------- sky ----------
export function makeSky(fogColor) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3a4a9a) },
      mid: { value: new THREE.Color(0xf08a7e) },
      hor: { value: fogColor.clone() },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = mix(hor, mid, smoothstep(0.0, 0.14, h)); c = mix(c, top, smoothstep(0.14, 0.65, h));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 16), mat);
  sky.renderOrder = -1;
  const sun = new THREE.Mesh(new THREE.CircleGeometry(22, 32), new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false }));
  sun.position.set(-110, 38, -380);
  sun.lookAt(0, 0, 0);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0xffc98a, fog: false, transparent: true, opacity: 0.35 }));
  glow.position.copy(sun.position).multiplyScalar(1.01);
  glow.lookAt(0, 0, 0);
  sky.add(sun, glow);
  return sky;
}

// ---------- scenery chunks ----------
function redwood(parts, x, z, h) {
  const trunkR = 0.3 + h * 0.025;
  parts.push(part(new THREE.CylinderGeometry(trunkR * 0.55, trunkR, h, 7), 0x7b3f26, x, h / 2, z));
  const greens = [0x1d4428, 0x24502e, 0x2e6238, 0x285a31];
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const y = h * 0.42 + i * h * 0.16;
    const r = (1 - i / layers) * h * 0.17 + 0.8;
    parts.push(part(new THREE.ConeGeometry(r, h * 0.3, 7), greens[i % greens.length], x, y, z, 0, Math.random() * 3));
  }
}

function bush(parts, x, z, s) {
  parts.push(part(new THREE.IcosahedronGeometry(s, 0), pick([0x3f7a3a, 0x4d8a3f, 0x356b33]), x, s * 0.6, z));
}

function fern(parts, x, z) {
  for (let i = 0; i < 4; i++) {
    parts.push(part(new THREE.ConeGeometry(0.18, 1.1, 4), 0x4f8f3a, x, 0.45, z, rand(-0.7, 0.7), 0, rand(-0.7, 0.7)));
  }
}

function rock(parts, x, z, s) {
  parts.push(part(new THREE.DodecahedronGeometry(s, 0), pick([0x8a8580, 0x777068, 0x9a9187]), x, s * 0.4, z, rand(0, 3), rand(0, 3)));
}

function lamp(parts, x, z) {
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6), 0x2b2b2b, x, 2.1, z));
  parts.push(part(new THREE.BoxGeometry(0.45, 0.5, 0.45), 0xfff1b8, x, 4.35, z));
  parts.push(part(new THREE.ConeGeometry(0.42, 0.3, 4), 0x2b2b2b, x, 4.75, z, 0, Math.PI / 4));
}

// Cowell-style white stucco + red tile roof
function cowellBuilding(parts, x, z) {
  const w = rand(6, 9), d = rand(9, 14), h = rand(4.5, 7);
  parts.push(part(new THREE.BoxGeometry(w, h, d), 0xefe3cf, x, h / 2, z));
  const roof = new THREE.ConeGeometry(Math.hypot(w, d) / 2 * 1.02, 2.2, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(w / Math.hypot(w, d) * Math.SQRT2, 1, d / Math.hypot(w, d) * Math.SQRT2);
  parts.push(part(roof, 0xb4532f, x, h + 1.1, z));
  const face = x > 0 ? x - w / 2 - 0.02 : x + w / 2 + 0.02;
  for (let row = 0; row < 2; row++) {
    for (let i = -1; i <= 1; i++) {
      parts.push(part(new THREE.BoxGeometry(0.08, 1.1, 1.2), 0x3a4660, face, 1.6 + row * 2.2, z + i * d * 0.28));
    }
  }
}

function bench(parts, x, z) {
  parts.push(part(new THREE.BoxGeometry(0.6, 0.12, 2), 0x8a5a3a, x, 0.55, z));
  parts.push(part(new THREE.BoxGeometry(0.12, 0.6, 2), 0x8a5a3a, x + (x > 0 ? 0.25 : -0.25), 0.85, z));
  parts.push(part(new THREE.BoxGeometry(0.5, 0.55, 0.1), 0x333333, x, 0.27, z - 0.8));
  parts.push(part(new THREE.BoxGeometry(0.5, 0.55, 0.1), 0x333333, x, 0.27, z + 0.8));
}

export function buildChunk() {
  const parts = [];
  const edge = PATH_W / 2;
  // left: dense redwood forest
  for (let i = 0; i < 6; i++) redwood(parts, -rand(edge + 4, edge + 34), rand(-CHUNK / 2, CHUNK / 2), rand(14, 26));
  // right: meadow side, fewer trees, sometimes a Cowell building
  if (Math.random() < 0.45) cowellBuilding(parts, rand(edge + 10, edge + 16), rand(-8, 8));
  else for (let i = 0; i < 2; i++) redwood(parts, rand(edge + 6, edge + 22), rand(-CHUNK / 2, CHUNK / 2), rand(12, 22));
  redwood(parts, rand(edge + 20, edge + 34), rand(-CHUNK / 2, CHUNK / 2), rand(14, 24));
  for (let i = 0; i < 5; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * rand(edge + 1.2, edge + 5);
    const z = rand(-CHUNK / 2, CHUNK / 2);
    const r = Math.random();
    if (r < 0.4) bush(parts, x, z, rand(0.5, 1.1));
    else if (r < 0.7) fern(parts, x, z);
    else rock(parts, x, z, rand(0.3, 0.8));
  }
  lamp(parts, -(edge + 0.8), -CHUNK / 4);
  lamp(parts, edge + 0.8, CHUNK / 4);
  if (Math.random() < 0.35) bench(parts, edge + 2.2, rand(-12, 12));
  return merged(parts);
}

// Occasional campus arch spanning the path
const ARCH_TEXT = ['COWELL COLLEGE', 'UC SANTA CRUZ', 'GO SLUGS!', 'EAST FIELD GYM', 'PORTER MEADOW', 'BAY TREE BOOKSTORE', 'STEVENSON', 'OPERS WEIGHT ROOM', 'COWELL BEACH → 2MI'];
export function buildArch() {
  const g = new THREE.Group();
  const x = PATH_W / 2 + 0.7;
  const parts = [
    part(new THREE.BoxGeometry(0.9, 7, 0.9), 0xefe3cf, -x, 3.5, 0),
    part(new THREE.BoxGeometry(0.9, 7, 0.9), 0xefe3cf, x, 3.5, 0),
    part(new THREE.BoxGeometry(x * 2 + 1.6, 0.5, 1.2), 0xb4532f, 0, 7.2, 0),
  ];
  g.add(merged(parts));
  const signMat = new THREE.MeshLambertMaterial({ map: textTex(pick(ARCH_TEXT), { w: 1024, h: 160, bg: '#10325e', fg: '#ffd23f', border: '#ffd23f' }) });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(x * 2 - 0.4, 1.1, 0.2), [vcMatPlain, vcMatPlain, vcMatPlain, vcMatPlain, signMat, signMat]);
  sign.position.set(0, 6.3, 0);
  g.add(sign);
  g.userData.setText = (t) => {
    signMat.map.dispose();
    signMat.map = textTex(t, { w: 1024, h: 160, bg: '#10325e', fg: '#ffd23f', border: '#ffd23f' });
    signMat.needsUpdate = true;
  };
  g.userData.texts = ARCH_TEXT;
  return g;
}
const vcMatPlain = new THREE.MeshLambertMaterial({ color: 0x10325e });

// ---------- obstacles ----------
// Each builder returns an Object3D whose origin is at ground level, centered on its lane.
function buildSlug() {
  const body = new THREE.CapsuleGeometry(0.42, 1.1, 4, 10);
  body.rotateX(Math.PI / 2);
  body.scale(1, 0.75, 1);
  const parts = [part(body, 0xf2d024, 0, 0.34, 0)];
  // spots
  for (let i = 0; i < 5; i++) parts.push(part(new THREE.SphereGeometry(0.1, 5, 4), 0x5a4a10, rand(-0.25, 0.25), 0.62, rand(-0.6, 0.4)));
  // eye stalks toward the player (+z)
  for (const s of [-1, 1]) {
    parts.push(part(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 5), 0xe0c020, s * 0.14, 0.72, 0.72, -0.5, 0, s * 0.25));
    parts.push(part(new THREE.SphereGeometry(0.08, 6, 5), 0x1b1030, s * 0.2, 0.97, 0.86));
  }
  return merged(parts);
}

function buildTurkey() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.45, 8, 6);
  body.scale(1, 0.9, 1.15);
  parts.push(part(body, 0x5a3a22, 0, 0.72, 0));
  const fan = new THREE.CylinderGeometry(0.85, 0.85, 0.08, 12, 1, false, -Math.PI / 2, Math.PI);
  fan.rotateZ(Math.PI / 2);
  fan.rotateY(Math.PI / 2);
  parts.push(part(fan, 0x7a4a2a, 0, 0.85, -0.45));
  const fan2 = new THREE.CylinderGeometry(0.6, 0.6, 0.1, 12, 1, false, -Math.PI / 2, Math.PI);
  fan2.rotateZ(Math.PI / 2);
  fan2.rotateY(Math.PI / 2);
  parts.push(part(fan2, 0xc9a070, 0, 0.85, -0.4));
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6), 0x6e7f99, 0, 1.2, 0.35, 0.3));
  parts.push(part(new THREE.SphereGeometry(0.13, 7, 6), 0x8aa0bb, 0, 1.45, 0.42));
  parts.push(part(new THREE.SphereGeometry(0.07, 6, 5), 0xd0202a, 0, 1.33, 0.52));
  parts.push(part(new THREE.ConeGeometry(0.05, 0.14, 4), 0xe0a020, 0, 1.45, 0.58, Math.PI / 2));
  for (const s of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 5), 0xe0a020, s * 0.15, 0.2, 0));
  return merged(parts);
}

function buildLog(width) {
  const parts = [part(new THREE.CylinderGeometry(0.45, 0.48, width, 9), 0x6b3a22, 0, 0.45, 0, 0, 0, Math.PI / 2)];
  for (const s of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 9), 0xc98b5a, s * width / 2, 0.45, 0, 0, 0, Math.PI / 2));
  // little branch stubs
  parts.push(part(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 5), 0x6b3a22, width * 0.2, 0.9, 0, 0.3));
  parts.push(part(new THREE.CylinderGeometry(0.08, 0.12, 0.5, 5), 0x6b3a22, -width * 0.25, 0.85, 0, -0.4));
  return merged(parts);
}

const BANNER_TEXT = ['GO SLUGS!', 'FEAR THE SLUG', 'WELCOME TO UCSC', 'WELCOME WEEK', 'MOVE-IN DAY', 'FARMERS MARKET', 'CAUTION: DEER', 'BIKES YIELD', 'STAY ON TRAIL', 'MCHENRY LIBRARY', 'QUARRY PLAZA', 'HOMECOMING', 'SLUG PRIDE'];
function buildBanner(width) {
  const g = new THREE.Group();
  const parts = [];
  for (const s of [-1, 1]) parts.push(part(new THREE.CylinderGeometry(0.08, 0.08, 2.9, 6), 0x3a3a3a, s * (width / 2), 1.45, 0));
  g.add(merged(parts));
  const tex = textTex(pick(BANNER_TEXT), { w: 1024, h: 256, bg: '#c81e3a', fg: '#ffffff', border: '#ffffff' });
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const edgeMat = new THREE.MeshLambertMaterial({ color: 0xc81e3a });
  const board = new THREE.Mesh(new THREE.BoxGeometry(width, 1.05, 0.12), [edgeMat, edgeMat, edgeMat, edgeMat, mat, mat]);
  board.position.y = 2.05;
  board.castShadow = true;
  g.add(board);
  return g;
}

let busSideTex, busFrontTex;
function buildBus() {
  busSideTex ||= canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#10325e'; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#ffc933'; g.fillRect(0, h * 0.58, w, h * 0.06);
    g.fillStyle = '#2a3a52';
    for (let i = 0; i < 7; i++) g.fillRect(16 + i * 70, h * 0.12, 56, h * 0.36);
    g.fillStyle = '#ffffff'; g.font = 'bold 34px "Luckiest Guy", Impact, sans-serif'; g.textAlign = 'center';
    g.fillText('CAMPUS LOOP', w / 2, h * 0.9);
  });
  busFrontTex ||= canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a3a52'; g.fillRect(14, 30, w - 28, h * 0.42);
    g.fillStyle = '#1b1030'; g.fillRect(40, 6, w - 80, 22);
    g.fillStyle = '#ffc933'; g.font = 'bold 18px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('LOOP  ·  COWELL', w / 2, 23);
    g.fillStyle = '#10325e'; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#fff6c0';
    g.beginPath(); g.arc(40, h * 0.8, 18, 0, 7); g.arc(w - 40, h * 0.8, 18, 0, 7); g.fill();
  });
  const side = new THREE.MeshLambertMaterial({ map: busSideTex });
  const front = new THREE.MeshLambertMaterial({ map: busFrontTex });
  const roof = new THREE.MeshLambertMaterial({ color: 0xe8e4da });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 2.8, 10), [side, side, roof, roof, front, front]);
  body.position.y = 1.65;
  body.castShadow = true;
  g.add(body);
  const wheels = [];
  for (const sx of [-1, 1]) for (const sz of [-3.2, 3.2]) wheels.push(part(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 10), 0x151515, sx * 1.0, 0.45, sz, 0, 0, Math.PI / 2));
  g.add(merged(wheels));
  return g;
}

// Obstacle catalogue: hitbox is [bottom, top] vertically, w wide (x), len deep (z).
export const OBSTACLES = {
  slug: { w: 1.0, len: 1.8, bottom: 0, top: 0.8, build: buildSlug },
  turkey: { w: 1.0, len: 1.1, bottom: 0, top: 1.0, build: buildTurkey },
  log: { w: 2.0, len: 0.9, bottom: 0, top: 0.85, build: () => buildLog(2.0) },
  logWide: { w: PATH_W - 0.8, len: 0.9, bottom: 0, top: 0.85, wide: true, build: () => buildLog(PATH_W - 0.8) },
  banner: { w: 2.0, len: 0.3, bottom: 1.35, top: 2.8, build: () => buildBanner(2.0) },
  bannerWide: { w: PATH_W - 0.4, len: 0.3, bottom: 1.35, top: 2.8, wide: true, build: () => buildBanner(PATH_W - 0.4) },
  bus: { w: 2.0, len: 10, bottom: 0, top: 3.0, build: buildBus },
};

// ---------- pickups ----------
const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc933, emissive: 0x6b4200, metalness: 0.7, roughness: 0.3 });
let dumbbellGeo;
function buildDumbbell() {
  dumbbellGeo ||= (() => {
    const parts = [new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8).rotateZ(Math.PI / 2)];
    for (const s of [-1, 1]) {
      parts.push(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 12).rotateZ(Math.PI / 2).translate(s * 0.28, 0, 0));
      parts.push(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12).rotateZ(Math.PI / 2).translate(s * 0.36, 0, 0));
    }
    return mergeGeometries(parts);
  })();
  const m = new THREE.Mesh(dumbbellGeo, goldMat);
  const g = new THREE.Group();
  m.rotation.z = 0.5;
  g.add(m);
  return g;
}

function glowRing(color) {
  const r = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  r.rotation.x = Math.PI / 2;
  r.position.y = -0.55;
  return r;
}

function buildCup() {
  const g = new THREE.Group();
  const parts = [
    part(new THREE.CylinderGeometry(0.3, 0.2, 0.7, 12, 1, true), 0xd4202c),
    part(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 12), 0xffffff, 0, 0.35, 0),
    part(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), 0xf2b632, 0, 0.3, 0),
    part(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12), 0xd4202c, 0, -0.35, 0),
  ];
  const m = merged(parts);
  m.material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x401010 });
  g.add(m, glowRing(0xffb020));
  return g;
}

function buildBoost() {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 0.9, flatShading: true }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 20), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
  g.add(orb, ring, glowRing(0xff7a1a));
  g.userData.spin = ring;
  return g;
}

function buildShake() {
  const g = new THREE.Group();
  const parts = [
    part(new THREE.CylinderGeometry(0.22, 0.2, 0.62, 12), 0xeae6f2),
    part(new THREE.CylinderGeometry(0.2, 0.18, 0.4, 12), 0x6b3b22, 0, -0.08, 0),
    part(new THREE.CylinderGeometry(0.23, 0.23, 0.14, 12), 0x1b1b1b, 0, 0.37, 0),
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), 0x1b1b1b, 0, 0.48, 0),
  ];
  const m = merged(parts);
  m.material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x202030 });
  g.add(m, glowRing(0x5ce1ff));
  return g;
}

function buildPhone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.07), new THREE.MeshLambertMaterial({ color: 0x151515 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.66), new THREE.MeshBasicMaterial({
    map: canvasTex(64, 128, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ff5c8a'); gr.addColorStop(1, '#ffb347');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      // chat bubble with a heart
      c.fillStyle = '#ffffff';
      c.beginPath(); c.ellipse(w / 2, h / 2 - 4, 22, 17, 0, 0, 7); c.fill();
      c.beginPath(); c.moveTo(w / 2 - 12, h / 2 + 8); c.lineTo(w / 2 - 18, h / 2 + 22); c.lineTo(w / 2 - 2, h / 2 + 11); c.fill();
      c.fillStyle = '#ff5c8a';
      c.beginPath(); c.arc(w / 2 - 5, h / 2 - 8, 5.5, 0, 7); c.arc(w / 2 + 5, h / 2 - 8, 5.5, 0, 7); c.fill();
      c.beginPath(); c.moveTo(w / 2 - 10.5, h / 2 - 6); c.lineTo(w / 2, h / 2 + 5); c.lineTo(w / 2 + 10.5, h / 2 - 6); c.fill();
    }),
  }));
  screen.position.z = 0.04;
  const back = screen.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.04;
  g.add(body, screen, back, glowRing(0xff5c8a));
  return g;
}

export const PICKUPS = {
  gains: { build: buildDumbbell, y: 0.9 },
  beer: { build: buildCup, y: 1.0 },
  boost: { build: buildBoost, y: 1.0 },
  shake: { build: buildShake, y: 1.0 },
  phone: { build: buildPhone, y: 1.1 },
};
