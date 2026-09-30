// All-time arcade leaderboard backed by Supabase (table public.samrun_scores).
// The anon key is public by design: the table is read-only to it, and scores can
// only be written through the samrun_* functions (see supabase/), which sanity-check runs.
const URL = 'https://wzlmvozcvwvxnrlsafwz.supabase.co/rest/v1';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6bG12b3pjdnd2eG5ybHNhZnd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAzMDQwMzUsImV4cCI6MjA2NTg4MDAzNX0.3tm8n4RlsNi3PdrFxw_rWpiOd6-P7grWb_dxppancg8';
const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

export const NAME_MAX = 12;
export const NAME_PATTERN = /^[A-Z0-9 _.!?'-]+$/;

export function cleanName(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9 _.!?'-]/g, '').replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

export async function fetchTop(limit = 100) {
  const res = await fetch(`${URL}/samrun_scores?select=name,score,distance,digits&order=score.desc,updated_at.asc&limit=${limit}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`leaderboard ${res.status}`);
  return res.json();
}

// Call one of the samrun_* Postgres functions. Errors carry the function's message
// ("name taken", "invalid run", ...).
export async function rpc(fn, args) {
  const res = await fetch(`${URL}/rpc/${fn}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `${fn} ${res.status}`);
  return body;
}
