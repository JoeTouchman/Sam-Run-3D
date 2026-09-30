-- Sam Run 3D accounts: banked dumbbells, skins, missions, daily streak.
-- Applied to the Supabase project as migration "samrun_accounts"; kept here for reference.
--
-- Accounts are self-contained (username + bcrypt password + opaque session token) rather than
-- Supabase Auth, because this project's Auth is shared with other apps and requires confirmed
-- emails. Nothing here is readable or writable directly by anon: every read/write goes through
-- the security-definer functions below, which take the session token.
--
-- Scoring is unchanged: samrun_finish_run applies exactly the same sanity checks as
-- samrun_submit_score. Existing leaderboard rows (account_id null) are claimed by whoever
-- signs up with that exact name first.

create table public.samrun_accounts (
  id bigint generated always as identity primary key,
  name text not null,
  name_key text generated always as (upper(name)) stored unique,
  pass_hash text not null,
  coins integer not null default 0 check (coins >= 0),
  skins text[] not null default '{sam}',
  equipped text not null default 'sam',
  missions jsonb not null default '{}'::jsonb,
  daily_day date,
  daily_streak integer not null default 0,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.samrun_accounts enable row level security;

create table public.samrun_sessions (
  token_hash text primary key,
  account_id bigint not null references public.samrun_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index samrun_sessions_account_idx on public.samrun_sessions (account_id);
alter table public.samrun_sessions enable row level security;

alter table public.samrun_scores
  add column account_id bigint unique references public.samrun_accounts (id) on delete set null;

-- ---------- helpers (not callable by anon) ----------

create or replace function public.samrun_clean_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.samrun_new_session(p_account bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.samrun_sessions (token_hash, account_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_account);
  -- keep at most 10 sessions per account
  delete from public.samrun_sessions s where s.account_id = p_account and s.token_hash not in (
    select s2.token_hash from public.samrun_sessions s2 where s2.account_id = p_account order by s2.last_seen desc limit 10);
  return v_token;
end;
$$;

create or replace function public.samrun_auth(p_token text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  update public.samrun_sessions s set last_seen = now()
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.last_seen > now() - interval '180 days'
  returning s.account_id into v_id;
  if v_id is null then raise exception 'not signed in'; end if;
  return v_id;
end;
$$;

create or replace function public.samrun_profile_json(p_account bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', a.name, 'coins', a.coins, 'skins', to_jsonb(a.skins), 'equipped', a.equipped,
    'missions', a.missions, 'dailyDay', a.daily_day, 'dailyStreak', a.daily_streak,
    'best', coalesce(s.score, 0))
  from public.samrun_accounts a
  left join public.samrun_scores s on s.account_id = a.id
  where a.id = p_account;
$$;

revoke all on function public.samrun_clean_name(text) from public, anon, authenticated;
revoke all on function public.samrun_new_session(bigint) from public, anon, authenticated;
revoke all on function public.samrun_auth(text) from public, anon, authenticated;
revoke all on function public.samrun_profile_json(bigint) from public, anon, authenticated;

-- ---------- public API ----------

-- For the sign-up form: is the name free, and is there an unclaimed leaderboard score to claim?
create or replace function public.samrun_name_status(p_name text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_name text := public.samrun_clean_name(p_name);
begin
  return jsonb_build_object(
    'taken', exists (select 1 from public.samrun_accounts a where a.name_key = v_name),
    'legacy', (select s.score from public.samrun_scores s where s.name_key = v_name and s.account_id is null));
end;
$$;

create or replace function public.samrun_signup(p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := public.samrun_clean_name(p_name);
  v_id bigint;
  v_bonus integer := 0;
  v_claimed integer;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 12 or v_name !~ '^[A-Z0-9 _.!?''-]+$' then
    raise exception 'invalid name';
  end if;
  if char_length(coalesce(p_password, '')) < 4 or char_length(p_password) > 72 then
    raise exception 'invalid password';
  end if;
  if exists (select 1 from public.samrun_accounts a where a.name_key = v_name) then
    raise exception 'name taken';
  end if;

  insert into public.samrun_accounts (name, pass_hash)
  values (v_name, extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
  returning id into v_id;

  -- Claim an existing unclaimed leaderboard row with this name; its lifetime dumbbells become a welcome stash.
  update public.samrun_scores s set account_id = v_id
  where s.name_key = v_name and s.account_id is null
  returning s.gains, s.score into v_bonus, v_claimed;
  if v_bonus is not null and v_bonus > 0 then
    update public.samrun_accounts a set coins = v_bonus where a.id = v_id;
  end if;

  return jsonb_build_object('token', public.samrun_new_session(v_id), 'profile', public.samrun_profile_json(v_id),
                            'claimed', v_claimed, 'welcome', coalesce(v_bonus, 0));
end;
$$;

create or replace function public.samrun_login(p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_name text := public.samrun_clean_name(p_name);
  a public.samrun_accounts%rowtype;
begin
  select * into a from public.samrun_accounts x where x.name_key = v_name;
  if a.id is null then raise exception 'wrong name or password'; end if;
  if a.locked_until is not null and a.locked_until > now() then raise exception 'too many tries'; end if;
  if a.pass_hash <> extensions.crypt(coalesce(p_password, ''), a.pass_hash) then
    update public.samrun_accounts x
    set failed_logins = x.failed_logins + 1,
        locked_until = case when x.failed_logins + 1 >= 8 then now() + interval '5 minutes' else null end
    where x.id = a.id;
    raise exception 'wrong name or password';
  end if;
  update public.samrun_accounts x set failed_logins = 0, locked_until = null where x.id = a.id;
  return jsonb_build_object('token', public.samrun_new_session(a.id), 'profile', public.samrun_profile_json(a.id));
end;
$$;

create or replace function public.samrun_logout(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.samrun_sessions s where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.samrun_get_profile(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.samrun_profile_json(public.samrun_auth(p_token));
end;
$$;

-- End of a run: same anti-cheat checks as samrun_submit_score, then post the best score,
-- bank the run's dumbbells + mission bonus (capped) + the daily streak bonus (computed here).
create or replace function public.samrun_finish_run(
  p_token text, p_score integer, p_distance integer, p_gains integer, p_digits integer,
  p_smashes integer, p_duration real, p_bonus integer, p_missions jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint := public.samrun_auth(p_token);
  a public.samrun_accounts%rowtype;
  v_prev integer;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_streak integer;
  v_daily integer := 0;
  v_bonus integer := least(greatest(coalesce(p_bonus, 0), 0), 2000);
  v_rank bigint;
  v_best integer;
begin
  if p_score < 0 or p_distance < 0 or p_gains < 0 or p_digits < 0 or p_smashes < 0
     or p_duration is null or p_duration <= 0 or p_duration > 4 * 3600 then
    raise exception 'invalid run';
  end if;
  if p_distance > p_duration * 48 + 20
     or p_gains > p_distance
     or p_digits > p_distance / 40 + 1
     or p_smashes > p_distance / 5 + 1
     or p_score > 2 * (p_distance + 10 * p_gains + 250 * p_digits + 50 * p_smashes) + 10 then
    raise exception 'invalid run';
  end if;
  if p_missions is not null and length(p_missions::text) > 4000 then
    raise exception 'invalid run';
  end if;

  select * into a from public.samrun_accounts x where x.id = v_id for update;
  if a.last_run_at is not null and a.last_run_at > now() - interval '3 seconds' then
    raise exception 'slow down';
  end if;

  -- daily streak: first finished run of each (Pacific) day, 7-day cycle
  if a.daily_day is null or a.daily_day < v_today then
    v_streak := case when a.daily_day = v_today - 1 then a.daily_streak % 7 + 1 else 1 end;
    v_daily := (array[100, 150, 200, 300, 450, 650, 1000])[v_streak];
  else
    v_streak := a.daily_streak;
  end if;

  update public.samrun_accounts x
  set coins = x.coins + p_gains + v_bonus + v_daily,
      daily_day = v_today, daily_streak = v_streak,
      missions = coalesce(p_missions, x.missions),
      last_run_at = now()
  where x.id = v_id;

  -- a row posted under this name by the old (pre-accounts) function gets merged in
  update public.samrun_scores s set account_id = v_id
  where s.name_key = a.name_key and s.account_id is null
    and not exists (select 1 from public.samrun_scores s2 where s2.account_id = v_id);

  select s.score into v_prev from public.samrun_scores s where s.account_id = v_id;
  if v_prev is null then
    insert into public.samrun_scores (name, score, distance, gains, digits, account_id)
    values (a.name, p_score, p_distance, p_gains, p_digits, v_id);
  elsif p_score > v_prev then
    update public.samrun_scores s
    set score = p_score, distance = p_distance, gains = p_gains, digits = p_digits, name = a.name, updated_at = now()
    where s.account_id = v_id;
  end if;

  select s.score into v_best from public.samrun_scores s where s.account_id = v_id;
  select count(*) + 1 into v_rank from public.samrun_scores o where o.score > v_best;

  return jsonb_build_object(
    'rank', v_rank, 'best', v_best, 'improved', v_prev is null or p_score > v_prev,
    'banked', p_gains + v_bonus + v_daily, 'bonus', v_bonus, 'daily', v_daily, 'streak', v_streak,
    'profile', public.samrun_profile_json(v_id));
end;
$$;

create or replace function public.samrun_save_missions(p_token text, p_missions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id bigint := public.samrun_auth(p_token);
begin
  if p_missions is null or length(p_missions::text) > 4000 then raise exception 'invalid missions'; end if;
  update public.samrun_accounts x set missions = p_missions where x.id = v_id;
end;
$$;

-- Skins shop. Prices live here so the client can't set them.
create or replace function public.samrun_buy(p_token text, p_skin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint := public.samrun_auth(p_token);
  v_price integer := case p_skin when 'dad' then 2500 when 'business' then 5000 when 'familiar' then 10000 end;
  a public.samrun_accounts%rowtype;
begin
  if v_price is null then raise exception 'unknown skin'; end if;
  select * into a from public.samrun_accounts x where x.id = v_id for update;
  if p_skin = any (a.skins) then raise exception 'already owned'; end if;
  if a.coins < v_price then raise exception 'not enough dumbbells'; end if;
  update public.samrun_accounts x
  set coins = x.coins - v_price, skins = array_append(x.skins, p_skin), equipped = p_skin
  where x.id = v_id;
  return public.samrun_profile_json(v_id);
end;
$$;

create or replace function public.samrun_equip(p_token text, p_skin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint := public.samrun_auth(p_token);
begin
  update public.samrun_accounts x set equipped = p_skin where x.id = v_id and p_skin = any (x.skins);
  if not found then raise exception 'not owned'; end if;
  return public.samrun_profile_json(v_id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'samrun_name_status(text)', 'samrun_signup(text, text)', 'samrun_login(text, text)',
    'samrun_logout(text)', 'samrun_get_profile(text)',
    'samrun_finish_run(text, integer, integer, integer, integer, integer, real, integer, jsonb)',
    'samrun_save_missions(text, jsonb)', 'samrun_buy(text, text)', 'samrun_equip(text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Posting without an account is switched off (migration "samrun_accounts_only", applied
-- once the accounts site was live). samrun_submit_score is kept only for reference.
revoke execute on function public.samrun_submit_score(text, integer, integer, integer, integer, integer, real) from public, anon, authenticated;

-- Lockdown (migration "samrun_accounts_lockdown"): no table access for API roles at all.
revoke all on table public.samrun_accounts, public.samrun_sessions from anon, authenticated;
