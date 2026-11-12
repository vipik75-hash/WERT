-- STONE AWARDS: заменить старые номинации новым списком.
-- ВНИМАНИЕ: сначала сделайте резервную копию. Удаление categories каскадно удалит старые голоса и старых номинантов.
-- Участники, их коды и учётные записи НЕ удаляются.
-- Выполняйте после schema.sql в Supabase -> SQL Editor.

begin;

drop table if exists pg_temp.stone_awards_seed_people;

create temporary table stone_awards_seed_people (
  display_name text primary key,
  participant_id uuid not null,
  access_code text
) on commit preserve rows;

alter table public.categories add column if not exists fixed_winner text;

-- Ищем существующих участников по имени. Для отсутствующих создаём учётные записи
-- с новыми кодами доступа; коды будут показаны в результате последнего SELECT.
do $$
declare
  v_name text;
  v_id uuid;
  v_code text;
  v_names text[] := array[
    'coreqwc', 'Whisper', 'Devatiy', 'unitazik', 'Terr', '2012', 'fogi',
    'weeklyy', '4etr1', 'sa_MI', 'фанк', 'СаняТЦК', 'dm'
  ];
begin
  foreach v_name in array v_names loop
    select id into v_id
    from public.participants
    where lower(display_name) = lower(v_name)
    order by created_at
    limit 1;

    if v_id is null then
      v_code := 'STONE-' || upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10));
      insert into public.participants(display_name, code_hash)
      values (v_name, extensions.crypt(v_code, extensions.gen_salt('bf')))
      returning id into v_id;
    else
      v_code := null;
      update public.participants set display_name = v_name where id = v_id;
    end if;

    insert into stone_awards_seed_people(display_name, participant_id, access_code)
    values (v_name, v_id, v_code);
  end loop;
end $$;

-- Старые категории удаляются вместе с голосами и связями nominees (ON DELETE CASCADE).
delete from public.categories;

with category_seed(title, description, sort_order, fixed_winner) as (
  values
    ('Завоз года', 'За самое громкое и запоминающееся появление.', 1, null::text),
    ('STONE KING', 'Настоящий король каменного сообщества.', 2, null::text),
    ('Легенда года', 'Человек, которого невозможно забыть.', 3, null::text),
    ('Мем года', 'За самый смешной и запоминающийся мем.', 4, null::text),
    ('Открытие года', 'Для тех, кто неожиданно заявил о себе.', 5, null::text),
    ('Кринж года', 'За самые неловкие и запоминающиеся моменты.', 6, null::text),
    ('Персона года', 'За особый вклад в жизнь сообщества.', 7, null::text),
    ('Токсик года', 'Обладатель самого узнаваемого характера.', 8, null::text),
    ('Событие года', 'За самый обсуждаемый момент.', 9, null::text),
    ('Ебень года', 'Особое звание для самого выдающегося персонажа.', 10, null::text),
    ('Мультигеймер года', 'Для человека, который успел покорить множество игр.', 11, null::text),
    ('Ксер года', 'За особые достижения в своей номинации.', 12, null::text),
    ('Дуо года', 'Для самой узнаваемой и слаженной пары.', 13, null::text),
    ('Дотер года', 'Главный представитель мира Dota 2.', 14, null::text),
    ('Растер года', 'Для настоящего представителя Rust.', 15, null::text),
    ('Аура года', 'За максимальную харизму и присутствие.', 16, null::text),
    ('Харизма года', 'Для человека с самой узнаваемой личностью.', 17, null::text),
    ('Актив года', 'Для самого активного участника сообщества.', 18, null::text),
    ('Пидорас года', 'Номинация уже нашла своего обладателя — её досрочно забрал КАБАН! 🏆', 19, 'КАБАН!'),
    ('IQ года', 'За выдающийся интеллект, логику и нестандартное мышление.', 20, null::text)
), inserted as (
  insert into public.categories(title, description, is_open, is_secret, is_released, fixed_winner, sort_order)
  select title, description, false, false, true, fixed_winner, sort_order
  from category_seed
  order by sort_order
  returning id, title, fixed_winner
)
insert into public.nominees(category_id, participant_id)
select inserted.id, people.participant_id
from inserted
cross join stone_awards_seed_people people
where inserted.fixed_winner is null;

commit;

-- Сохраните и передайте участникам только те коды, которые были созданы этим скриптом.
select display_name as "Участник", access_code as "Новый код доступа"
from stone_awards_seed_people
where access_code is not null
order by display_name;
