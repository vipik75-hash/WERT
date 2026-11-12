-- STONE AWARDS 2026
-- Выполните весь файл в Supabase -> SQL Editor -> New query.
-- Расширение pgcrypto используется для хеширования кодов и токенов.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  code_hash text not null,
  session_hash text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  is_open boolean not null default false,
  is_secret boolean not null default false,
  is_released boolean not null default false,
  fixed_winner text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.categories add column if not exists fixed_winner text;

create table if not exists public.nominees (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(category_id, participant_id)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  nominee_id uuid not null references public.nominees(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(participant_id, category_id)
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null
);

insert into public.app_settings(key, value)
values ('results_visible', 'false'::jsonb)
on conflict (key) do nothing;

-- Таблицы доступны только через функции ниже.
alter table public.participants enable row level security;
alter table public.categories enable row level security;
alter table public.nominees enable row level security;
alter table public.votes enable row level security;
alter table public.admin_users enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.participants, public.categories, public.nominees,
  public.votes, public.admin_users, public.app_settings from anon, authenticated;

create or replace function public.is_stone_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.stone_participant_id(p_token text)
returns uuid
language sql
security definer
set search_path = public, extensions
as $$
  select id
  from public.participants
  where active = true
    and session_hash is not null
    and session_hash = extensions.crypt(p_token, session_hash)
  limit 1;
$$;

create or replace function public.redeem_access_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_participant public.participants%rowtype;
  v_token text;
begin
  if p_code is null or length(trim(p_code)) < 5 then
    raise exception 'Неверный код доступа.';
  end if;

  select * into v_participant
  from public.participants p
  where p.active = true
    and p.code_hash = extensions.crypt(upper(trim(p_code)), p.code_hash)
  limit 1;

  if not found then
    raise exception 'Код не найден или отключён.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.participants
  set session_hash = extensions.crypt(v_token, extensions.gen_salt('bf'))
  where id = v_participant.id;

  return jsonb_build_object(
    'token', v_token,
    'participant', jsonb_build_object(
      'id', v_participant.id,
      'display_name', v_participant.display_name
    )
  );
end;
$$;

create or replace function public.get_site_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pid uuid;
  v_results_visible boolean;
  v_categories jsonb;
begin
  v_pid := public.stone_participant_id(p_token);
  if v_pid is null then raise exception 'Сессия истекла. Войдите по коду ещё раз.'; end if;

  select coalesce((value #>> '{}')::boolean, false)
  into v_results_visible
  from public.app_settings where key = 'results_visible';
  v_results_visible := coalesce(v_results_visible, false);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'description', c.description,
      'is_open', c.is_open,
      'is_secret', c.is_secret,
      'is_released', c.is_released,
      'fixed_winner', c.fixed_winner,
      'my_vote', (select v.nominee_id from public.votes v where v.participant_id = v_pid and v.category_id = c.id limit 1),
      'nominees', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', n.id,
          'participant_id', p.id,
          'display_name', p.display_name,
          'votes', case when v_results_visible then
            (select count(*) from public.votes vv where vv.nominee_id = n.id)
            else null end
        ) order by p.display_name)
        from public.nominees n
        join public.participants p on p.id = n.participant_id
        where n.category_id = c.id
      ), '[]'::jsonb)
    ) order by c.sort_order, c.created_at
  ), '[]'::jsonb)
  into v_categories
  from public.categories c
  where c.is_secret = false or c.is_released = true or c.is_open = true;

  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', id, 'display_name', display_name) from public.participants where id = v_pid),
    'results_visible', v_results_visible,
    'categories', v_categories
  );
end;
$$;

create or replace function public.cast_vote(p_token text, p_category_id uuid, p_nominee_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pid uuid;
begin
  v_pid := public.stone_participant_id(p_token);
  if v_pid is null then raise exception 'Сессия истекла. Войдите по коду ещё раз.'; end if;

  if not exists (
    select 1 from public.categories
    where id = p_category_id and is_open = true
  ) then
    raise exception 'Это голосование сейчас закрыто.';
  end if;

  if not exists (
    select 1 from public.nominees
    where id = p_nominee_id and category_id = p_category_id
  ) then
    raise exception 'Выбранный номинант не относится к этой категории.';
  end if;

  insert into public.votes(participant_id, category_id, nominee_id)
  values (v_pid, p_category_id, p_nominee_id);

  return jsonb_build_object('success', true);
exception
  when unique_violation then
    raise exception 'Ты уже голосовал в этой номинации.';
end;
$$;

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_categories jsonb;
  v_participants jsonb;
  v_results_visible boolean;
begin
  if not public.is_stone_admin() then raise exception 'Доступ запрещён.'; end if;

  select coalesce((value #>> '{}')::boolean, false)
  into v_results_visible
  from public.app_settings where key = 'results_visible';
  v_results_visible := coalesce(v_results_visible, false);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'active', p.active
  ) order by p.display_name), '[]'::jsonb)
  into v_participants from public.participants p;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'is_open', c.is_open,
    'is_secret', c.is_secret,
    'is_released', c.is_released,
    'fixed_winner', c.fixed_winner,
    'nominees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'participant_id', p.id, 'display_name', p.display_name,
        'votes', (select count(*) from public.votes v where v.nominee_id = n.id)
      ) order by p.display_name)
      from public.nominees n join public.participants p on p.id = n.participant_id
      where n.category_id = c.id
    ), '[]'::jsonb)
  ) order by c.sort_order, c.created_at), '[]'::jsonb)
  into v_categories from public.categories c;

  return jsonb_build_object(
    'participants', v_participants,
    'categories', v_categories,
    'results_visible', v_results_visible
  );
end;
$$;

create or replace function public.admin_create_participant(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_id uuid;
begin
  if not public.is_stone_admin() then raise exception 'Доступ запрещён.'; end if;
  if p_display_name is null or length(trim(p_display_name)) < 2 then
    raise exception 'Укажите имя участника.';
  end if;

  v_code := 'STONE-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10));
  insert into public.participants(display_name, code_hash)
  values (trim(p_display_name), extensions.crypt(v_code, extensions.gen_salt('bf')))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'display_name', trim(p_display_name), 'code', v_code);
end;
$$;

create or replace function public.admin_create_category(p_title text, p_description text default '', p_is_secret boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_stone_admin() then raise exception 'Доступ запрещён.'; end if;
  if p_title is null or length(trim(p_title)) < 2 then raise exception 'Укажите название номинации.'; end if;
  insert into public.categories(title, description, is_secret, is_released)
  values (trim(p_title), coalesce(trim(p_description), ''), coalesce(p_is_secret,false), false)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_add_nominee(p_category_id uuid, p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_stone_admin() then raise exception 'Доступ запрещён.'; end if;
  insert into public.nominees(category_id, participant_id)
  values (p_category_id, p_participant_id);
  return jsonb_build_object('success', true);
exception when unique_violation then
  raise exception 'Этот участник уже добавлен в номинацию.';
end;
$$;

create or replace function public.admin_update_category(p_category_id uuid, p_is_open boolean, p_is_released boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_stone_admin() then raise exception 'Доступ запрещён.'; end if;
  if exists (select 1 from public.categories where id = p_category_id and fixed_winner is not null) then
    raise exception 'Эта награда уже присуждена и не открывается для голосования.';
  end if;
  update public.categories
  set is_open = coalesce(p_is_open,false),
      is_released = case
        when coalesce(p_is_open,false) and is_secret then true
        else coalesce(p_is_released,false)
      end
  where id = p_category_id;
  if not found then raise exception 'Номинация не найдена.'; end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_set_results_visible(p_visible boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_stone_admin() then raise exception 'Доступ запрещён.'; end if;
  insert into public.app_settings(key, value)
  values ('results_visible', to_jsonb(coalesce(p_visible,false)))
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('success', true);
end;
$$;

-- Снимаем стандартное право EXECUTE у PUBLIC и выдаём только нужным ролям.
revoke all on function public.is_stone_admin() from public, anon, authenticated;
revoke all on function public.stone_participant_id(text) from public, anon, authenticated;
revoke all on function public.redeem_access_code(text) from public;
revoke all on function public.get_site_data(text) from public;
revoke all on function public.cast_vote(text, uuid, uuid) from public;
revoke all on function public.admin_dashboard() from public;
revoke all on function public.admin_create_participant(text) from public;
revoke all on function public.admin_create_category(text, text, boolean) from public;
revoke all on function public.admin_add_nominee(uuid, uuid) from public;
revoke all on function public.admin_update_category(uuid, boolean, boolean) from public;
revoke all on function public.admin_set_results_visible(boolean) from public;

-- Права на вызов RPC. Прямого доступа к таблицам у клиентов нет.
grant execute on function public.redeem_access_code(text) to anon, authenticated;
grant execute on function public.get_site_data(text) to anon, authenticated;
grant execute on function public.cast_vote(text, uuid, uuid) to anon, authenticated;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_create_participant(text) to authenticated;
grant execute on function public.admin_create_category(text, text, boolean) to authenticated;
grant execute on function public.admin_add_nominee(uuid, uuid) to authenticated;
grant execute on function public.admin_update_category(uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_set_results_visible(boolean) to authenticated;

-- После создания пользователя организатора в Supabase Auth выполните отдельно:
-- insert into public.admin_users(user_id)
-- select id from auth.users where email = 'ВАШ_EMAIL_ОРГАНИЗАТОРА'
-- on conflict do nothing;
