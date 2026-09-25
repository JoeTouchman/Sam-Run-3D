-- Sam Run 3D leaderboard. Already applied to the Supabase project
-- (migration "samrun_leaderboard"); kept here for reference.

create table public.samrun_scores (
  id bigint generated always as identity primary key,
  name text not null,
  name_key text generated always as (upper(name)) stored unique,
  score integer not null check (score >= 0),
  distance integer not null default 0,
  gains integer not null default 0,
  digits integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index samrun_scores_score_idx on public.samrun_scores (score desc);

-- Anyone can read the board; nobody writes directly (only through the function below).
alter table public.samrun_scores enable row level security;
create policy "samrun scores are public" on public.samrun_scores for select to anon, authenticated using (true);

-- Submit a run. Light sanity checks so a hand-crafted request can't post absurd numbers.
create or replace function public.samrun_submit_score(
  p_name text, p_score integer, p_distance integer, p_gains integer,
  p_digits integer, p_smashes integer, p_duration real
)
returns table (rank bigint, best integer, improved boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := upper(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  v_prev integer;
  v_last timestamptz;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 12 or v_name !~ '^[A-Z0-9 _.!?''-]+$' then
    raise exception 'invalid name';
  end if;
  if p_score < 0 or p_distance < 0 or p_gains < 0 or p_digits < 0 or p_smashes < 0
     or p_duration is null or p_duration <= 0 or p_duration > 4 * 3600 then
    raise exception 'invalid run';
  end if;
  -- physics: top speed with boost is under 48 m/s
  if p_distance > p_duration * 48 + 20
     or p_gains > p_distance
     or p_digits > p_distance / 40 + 1
     or p_smashes > p_distance / 5 + 1
     -- score = distance + 10/gain + 250/number + 50/smash, all at most doubled by drunk mode
     or p_score > 2 * (p_distance + 10 * p_gains + 250 * p_digits + 50 * p_smashes) + 10 then
    raise exception 'invalid run';
  end if;

  select s.score, s.updated_at into v_prev, v_last from public.samrun_scores s where s.name_key = v_name;
  if v_last is not null and v_last > now() - interval '3 seconds' then
    raise exception 'slow down';
  end if;

  insert into public.samrun_scores as s (name, score, distance, gains, digits)
  values (v_name, p_score, p_distance, p_gains, p_digits)
  on conflict (name_key) do update
    set score = excluded.score, distance = excluded.distance, gains = excluded.gains,
        digits = excluded.digits, name = excluded.name, updated_at = now()
    where excluded.score > s.score;

  return query
    select (select count(*) from public.samrun_scores o where o.score > s.score) + 1,
           s.score,
           v_prev is null or p_score > v_prev
    from public.samrun_scores s where s.name_key = v_name;
end;
$$;

revoke all on function public.samrun_submit_score(text, integer, integer, integer, integer, integer, real) from public;
grant execute on function public.samrun_submit_score(text, integer, integer, integer, integer, integer, real) to anon, authenticated;
