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
// Each template has 5 tiers. A set is one easy, one medium and one hard mission (three tiers in a
// row), and the whole ladder shifts up a tier every few sets.
const TEMPLATES = [
  { id: 'gains', perRun: true, text: (n) => `Collect ${n} dumbbells in one run`, tiers: [50, 100, 175, 275, 400] },
  { id: 'distance', perRun: true, text: (n) => `Run ${n.toLocaleString()}m in one run`, tiers: [500, 1000, 1600, 2500, 4000] },
  { id: 'jumps', text: (n) => `Jump ${n} times`, tiers: [25, 50, 80, 120, 180] },
  { id: 'banners', text: (n) => `Slide under ${n} banners`, tiers: [5, 12, 20, 30, 45] },
  { id: 'roof', text: (n) => `Run ${n}m on bus roofs`, tiers: [60, 150, 300, 500, 800] },
  { id: 'ramps', text: (n) => `Ride up ${n} bus ramps`, tiers: [3, 6, 10, 15, 22] },
  { id: 'digits', perRun: true, text: (n) => `Get ${n} number${n > 1 ? 's' : ''} in one run`, tiers: [1, 2, 3, 4, 6] },
  { id: 'smash', text: (n) => `Smash ${n} obstacles in Supersonic`, tiers: [3, 6, 10, 16, 24] },
  { id: 'shades', text: (n) => `Go Sexy Mode ${n} time${n > 1 ? 's' : ''}`, tiers: [1, 2, 4, 6, 9] },
  { id: 'rizzGains', text: (n) => `Pull in ${n} dumbbells in Sexy Mode`, tiers: [30, 70, 130, 200, 300] },
  { id: 'clean', perRun: true, text: (n) => `Run ${n.toLocaleString()}m without getting hurt`, tiers: [300, 600, 1000, 1600, 2500] },
  { id: 'drunkGains', text: (n) => `Collect ${n} dumbbells in Drunk mode`, tiers: [20, 50, 90, 140, 200] },
];
const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export const setReward = (set) => Math.min(2000, 250 + set * 150);

export const DIFFS = ['easy', 'medium', 'hard'];

// Deterministic per set so everyone's set N is the same three missions.
function missionsForSet(set) {
  let seed = (set + 1) * 2654435761 % 4294967296;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ids = TEMPLATES.map((t) => t.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const base = Math.min(2, Math.floor(set / 3));
  return ids.slice(0, 3).map((id, i) => ({ id, diff: DIFFS[i], target: byId[id].tiers[base + i], prog: 0 }));
}

export function freshMissions() { return { set: 0, list: missionsForSet(0) }; }

export function validMissions(m) {
  return m && Number.isInteger(m.set) && Array.isArray(m.list) && m.list.length === 3 && m.list.every((x) => byId[x.id]);
}

// Saves from before missions had difficulties get a fresh easy/medium/hard list for the same set.
export function upgradeMissions(m) {
  if (m.list.every((x) => DIFFS.includes(x.diff))) return m;
  return { set: m.set, list: missionsForSet(m.set) };
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
    this.state.set += 1;
    this.state.list = missionsForSet(this.state.set);
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
