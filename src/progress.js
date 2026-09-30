// Skins catalog and Subway-style missions. Prices here are for display only; the real
// ones live in the samrun_buy function in Supabase (keep the two in sync).

export const SKINS = [
  { id: 'sam', name: 'Sam', tag: 'The original', file: 'assets/sam.fbx', price: 0 },
  { id: 'dad', name: 'Dad Sam', tag: 'Grill master. New Balances.', file: 'assets/skins/dad.fbx', price: 2500 },
  { id: 'business', name: 'Business Sam', tag: 'Circling back on that run', file: 'assets/skins/business.fbx', price: 5000 },
  { id: 'familiar', name: 'Familiar Sam', tag: 'Haven’t we seen him somewhere?', file: 'assets/skins/familiar.fbx', price: 10000 },
];
for (const s of SKINS) s.thumb = `assets/skins/${s.id}_thumb.webp`;
export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

// ---------- missions ----------
// perRun: best single-run value counts; otherwise progress adds up across runs.
// Each template has 5 tiers of roughly matching effort (tier 0 is about a solid 3,000m run).
// A set is one easy, one medium and one hard mission (three tiers in a row), and the whole
// ladder shifts up a tier every 3 sets.
const TEMPLATES = [
  { id: 'distance', perRun: true, text: (n) => `Run ${n.toLocaleString()}m in one run`, tiers: [3000, 5000, 8000, 12000, 18000] },
  { id: 'clean', perRun: true, text: (n) => `Run ${n.toLocaleString()}m without getting hurt`, tiers: [1000, 2000, 3500, 5000, 8000] },
  { id: 'gains', perRun: true, text: (n) => `Collect ${n.toLocaleString()} dumbbells in one run`, tiers: [400, 700, 1100, 1600, 2500] },
  { id: 'digits', perRun: true, text: (n) => `Get ${n} numbers in one run`, tiers: [3, 5, 8, 12, 18] },
  { id: 'jumps', text: (n) => `Jump ${n.toLocaleString()} times`, tiers: [150, 300, 500, 800, 1200] },
  { id: 'banners', text: (n) => `Slide under ${n.toLocaleString()} banners`, tiers: [40, 80, 140, 220, 350] },
  { id: 'roof', text: (n) => `Run ${n.toLocaleString()}m on bus roofs`, tiers: [800, 1600, 3000, 5000, 8000] },
  { id: 'ramps', text: (n) => `Ride up ${n.toLocaleString()} bus ramps`, tiers: [25, 50, 90, 140, 220] },
  { id: 'smash', text: (n) => `Smash ${n.toLocaleString()} obstacles in Supersonic`, tiers: [30, 60, 100, 160, 250] },
  { id: 'shades', text: (n) => `Go Sexy Mode ${n} times`, tiers: [8, 15, 25, 40, 60] },
  { id: 'rizzGains', text: (n) => `Pull in ${n.toLocaleString()} dumbbells in Sexy Mode`, tiers: [300, 600, 1000, 1600, 2500] },
  { id: 'drunkGains', text: (n) => `Collect ${n.toLocaleString()} dumbbells in Drunk mode`, tiers: [250, 500, 900, 1400, 2200] },
];
const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));
const MISSIONS_VERSION = 2; // bump when the tiers change so old saves get fresh lists

// The server caps a run's mission bonus at 2,000.
export const setReward = (set) => Math.min(2000, 750 + set * 250);

export const DIFFS = ['easy', 'medium', 'hard'];

// Which three missions a set gets depends on the set number and the day it started,
// so a new set rolls a different mix each day. A set in progress stays put until it's done.
function missionsForSet(set, day) {
  let seed = 2166136261;
  for (const ch of `${set}|${day}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => { // mulberry32
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ids = TEMPLATES.map((t) => t.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const base = Math.min(2, Math.floor(set / 3));
  return ids.slice(0, 3).map((id, i) => ({ id, diff: DIFFS[i], target: byId[id].tiers[base + i], prog: 0 }));
}

function newSet(set) {
  const day = todayPT();
  return { v: MISSIONS_VERSION, set, day, list: missionsForSet(set, day) };
}

export function freshMissions() { return newSet(0); }

export function validMissions(m) {
  return m && Number.isInteger(m.set) && Array.isArray(m.list) && m.list.length === 3 && m.list.every((x) => byId[x.id]);
}

// Saves from an older mission table get a fresh list for the same set.
export function upgradeMissions(m) {
  return m.v === MISSIONS_VERSION ? m : newSet(m.set);
}

export const missionText = (m) => byId[m.id].text(m.target);

// Tracks one run against the current set. `run` is the live per-run stats object.
export class MissionRun {
  constructor(state) {
    this.state = state;
    this.start = state.list.map((m) => m.prog);
    this.done = state.list.map((m) => m.prog >= m.target);
  }

  // Current progress for each mission given this run's stats; returns indices newly completed.
  update(run) {
    const fresh = [];
    this.state.list.forEach((m, i) => {
      const t = byId[m.id];
      const v = run[m.id] || 0;
      m.prog = Math.min(m.target, t.perRun ? Math.max(this.start[i], Math.floor(v)) : this.start[i] + Math.floor(v));
      if (!this.done[i] && m.prog >= m.target) { this.done[i] = true; fresh.push(i); }
    });
    return fresh;
  }

  get allDone() { return this.done.every(Boolean); }

  // Called at the end of a run: if the set is complete, returns the reward and advances.
  finish() {
    if (!this.allDone) return 0;
    const reward = setReward(this.state.set);
    Object.assign(this.state, newSet(this.state.set + 1));
    return reward;
  }
}

// ---------- daily streak (the server decides the actual bonus) ----------
export const DAILY = [100, 150, 200, 300, 450, 650, 1000];
export const todayPT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
export function dailyReady(profile) { return !profile?.dailyDay || profile.dailyDay < todayPT(); }
export function nextDailyBonus(profile) {
  if (!profile?.dailyDay) return DAILY[0];
  const y = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const streak = profile.dailyDay === y ? (profile.dailyStreak % 7) + 1 : 1;
  return DAILY[streak - 1];
}
