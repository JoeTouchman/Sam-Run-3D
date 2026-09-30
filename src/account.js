// Sam Run accounts: username + password, backed by the samrun_* functions in Supabase
// (supabase/samrun_accounts.sql). The session token lives in localStorage; the server
// holds the wallet, owned skins, missions and daily streak.
import { rpc } from './leaderboard.js';

const TOKEN_KEY = 'samrun.token';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let token = store.get(TOKEN_KEY);
const listeners = new Set();

function setSession(t, profile) {
  token = t;
  store.set(TOKEN_KEY, t);
  Account.profile = profile;
  emit();
}
function emit() { for (const fn of listeners) fn(Account.profile); }
// A dead token (expired or signed out elsewhere) quietly drops back to guest.
function authFailed(err) {
  if (String(err.message).includes('not signed in')) setSession(null, null);
  throw err;
}

export const Account = {
  profile: null,
  get signedIn() { return !!(token && this.profile); },
  onChange(fn) { listeners.add(fn); },

  async restore() {
    if (!token) return null;
    try {
      this.profile = await rpc('samrun_get_profile', { p_token: token });
      emit();
    } catch (err) {
      if (String(err.message).includes('not signed in')) setSession(null, null);
    }
    return this.profile;
  },

  nameStatus(name) { return rpc('samrun_name_status', { p_name: name }); },

  async signUp(name, password) {
    const r = await rpc('samrun_signup', { p_name: name, p_password: password });
    setSession(r.token, r.profile);
    return r;
  },

  async signIn(name, password) {
    const r = await rpc('samrun_login', { p_name: name, p_password: password });
    setSession(r.token, r.profile);
    return r;
  },

  async signOut() {
    const t = token;
    setSession(null, null);
    try { await rpc('samrun_logout', { p_token: t }); } catch { /* already gone */ }
  },

  // Returns { rank, best, improved, banked, bonus, daily, streak, profile }.
  async finishRun({ score, distance, gains, digits, smashes, duration }, bonus, missions) {
    const r = await rpc('samrun_finish_run', {
      p_token: token,
      p_score: Math.floor(score),
      p_distance: Math.floor(distance),
      p_gains: gains,
      p_digits: digits,
      p_smashes: smashes,
      p_duration: Math.max(0.1, duration),
      p_bonus: bonus,
      p_missions: missions,
    }).catch(authFailed);
    this.profile = r.profile;
    emit();
    return r;
  },

  async buy(skin) {
    this.profile = await rpc('samrun_buy', { p_token: token, p_skin: skin }).catch(authFailed);
    emit();
    return this.profile;
  },

  async equip(skin) {
    this.profile = await rpc('samrun_equip', { p_token: token, p_skin: skin }).catch(authFailed);
    emit();
    return this.profile;
  },

  saveMissions(missions) {
    if (!this.signedIn) return Promise.resolve();
    return rpc('samrun_save_missions', { p_token: token, p_missions: missions }).catch(() => {});
  },
};
