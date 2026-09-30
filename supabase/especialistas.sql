-- =====================================================================
-- Agenda de Especialistas — SVN Investimentos (Campo Grande/MS)
-- Especialistas que visitam o escritório em datas específicas; cada
-- colega agenda o seu horário. Reunião no escritório reserva a sala
-- na mesma transação (a sala some da grade de salas na hora).
--
-- Só ACRESCENTA tabelas e funções: nada do schema.sql é alterado.
-- Pode ser executado mais de uma vez sem duplicar dados.
-- Rodar depois do schema.sql:
--   npx supabase db query --linked -f supabase/especialistas.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Visitas de especialistas
--    starts_at = chegada; ends_at = saída. Em cada dia o especialista atende
--    de day_start a day_end (07:00–19:00), exceto a partir da chegada no
--    primeiro dia e até a saída no último. Ex.: chega dia 20 às 09:00 e vai
--    embora dia 24 às 16:00 -> dia 20 09–19h, dias 21 a 23 07–19h, dia 24 07–16h.
-- ---------------------------------------------------------------------
create table if not exists public.specialist_visits (
  id               uuid primary key default gen_random_uuid(),
  specialist_name  text        not null check (char_length(btrim(specialist_name)) between 1 and 80),
  specialty        text        not null default '' check (char_length(specialty) <= 120),
  specialist_email text        check (specialist_email is null or specialist_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  include_weekends boolean     not null default false,
  notes            text        not null default '' check (char_length(notes) <= 500),
  created_by       uuid        default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint specialist_visits_time_order check (ends_at > starts_at)
);

-- ajustes para quem rodou a primeira versão deste script (um dia só, horários fixos)
alter table public.specialist_visits drop constraint if exists specialist_visits_one_day;
alter table public.specialist_visits add column if not exists include_weekends boolean not null default false;
alter table public.specialist_visits drop column if exists slot_minutes;
alter table public.specialist_visits drop constraint if exists specialist_visits_max_span;
alter table public.specialist_visits add constraint specialist_visits_max_span check (ends_at - starts_at <= interval '62 days');
-- horário de atendimento dos dias da visita (muda pelo SQL Editor, se precisar)
alter table public.specialist_visits add column if not exists day_start time not null default '07:00';
alter table public.specialist_visits add column if not exists day_end   time not null default '19:00';
alter table public.specialist_visits drop constraint if exists specialist_visits_day_hours;
alter table public.specialist_visits add constraint specialist_visits_day_hours check (day_start < day_end);

create index if not exists specialist_visits_starts_at_idx on public.specialist_visits (starts_at);

-- ---------------------------------------------------------------------
-- 2. Horários agendados com o especialista
--    location = 'office'  -> room_booking_id aponta para a reserva da sala
--    location = 'external'-> sem sala; external_place descreve o local
-- ---------------------------------------------------------------------
create table if not exists public.specialist_bookings (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid        not null references public.specialist_visits (id) on delete cascade,
  user_id         uuid        not null references public.profiles (id) on delete cascade,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  subject         text        not null check (char_length(btrim(subject)) between 1 and 120),
  location        text        not null check (location in ('office', 'external')),
  -- cancelar a reserva da sala (pela grade de salas) cancela também o horário com o especialista
  room_booking_id uuid        unique references public.bookings (id) on delete cascade,
  external_place  text        not null default '' check (char_length(external_place) <= 160),
  guest_emails    text[]      not null default '{}' check (cardinality(guest_emails) <= 10),
  created_at      timestamptz not null default now(),
  constraint specialist_bookings_time_order check (ends_at > starts_at),
  constraint specialist_bookings_room_when_office check ((location = 'office') = (room_booking_id is not null)),
  -- o especialista não atende duas pessoas ao mesmo tempo
  constraint specialist_bookings_no_overlap exclude using gist (
    visit_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index if not exists specialist_bookings_visit_idx on public.specialist_bookings (visit_id, starts_at);
create index if not exists specialist_bookings_user_idx on public.specialist_bookings (user_id, starts_at);

-- ---------------------------------------------------------------------
-- 3. Cancelar o horário com o especialista libera a sala junto
-- ---------------------------------------------------------------------
create or replace function public.release_specialist_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.room_booking_id is not null then
    delete from public.bookings where id = old.room_booking_id;
  end if;
  return old;
end;
$$;

drop trigger if exists specialist_bookings_release_room on public.specialist_bookings;
create trigger specialist_bookings_release_room
  after delete on public.specialist_bookings
  for each row execute function public.release_specialist_room();

-- Um horário [p_s, p_e) cabe no atendimento da visita? Devolve o motivo, ou null se cabe.
create or replace function public.specialist_window_error(v public.specialist_visits, p_s timestamptz, p_e timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text;
  ls timestamp;
  le timestamp;
  ds time;
  de time;
begin
  select timezone into tz from public.settings where id;
  ls := p_s at time zone tz;
  le := p_e at time zone tz;
  -- dia comum: day_start–day_end; dia da chegada começa na chegada; dia da saída termina na saída
  ds := v.day_start;
  de := v.day_end;
  if ls::date = (v.starts_at at time zone tz)::date then
    ds := greatest(ds, (v.starts_at at time zone tz)::time);
  end if;
  if ls::date = (v.ends_at at time zone tz)::date then
    de := least(de, (v.ends_at at time zone tz)::time);
  end if;

  if p_e <= p_s then
    return 'O fim precisa ser depois do início.';
  end if;
  if ls::date <> le::date then
    return 'O horário precisa começar e terminar no mesmo dia.';
  end if;
  if ls::date < (v.starts_at at time zone tz)::date or ls::date > (v.ends_at at time zone tz)::date then
    return 'Esse dia está fora do período da visita do especialista.';
  end if;
  if not v.include_weekends and extract(isodow from ls) > 5 then
    return 'O especialista não atende no fim de semana.';
  end if;
  if ls::time < ds or le::time > de then
    if ds >= de then
      return 'O especialista não atende nesse dia.';
    end if;
    return format('Nesse dia o especialista atende das %s às %s.', to_char(ds, 'HH24:MI'), to_char(de, 'HH24:MI'));
  end if;
  if extract(second from ls) <> 0 or extract(second from le) <> 0 then
    return 'Use horários em minutos cheios.';
  end if;
  return null;
end;
$$;

-- Mudar a visita não pode deixar agendamentos de fora
create or replace function public.validate_specialist_visit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  msg text;
begin

  select public.specialist_window_error(new, b.starts_at, b.ends_at) into msg
  from public.specialist_bookings b
  where b.visit_id = new.id and public.specialist_window_error(new, b.starts_at, b.ends_at) is not null
  limit 1;
  if msg is not null then
    raise exception 'Há horários agendados fora do novo período ou horário. Cancele-os antes de fazer essa mudança.';
  end if;
  new.specialist_name := btrim(new.specialist_name);
  new.specialty := btrim(new.specialty);
  new.specialist_email := nullif(lower(btrim(new.specialist_email)), '');
  return new;
end;
$$;

drop trigger if exists specialist_visits_validate on public.specialist_visits;
create trigger specialist_visits_validate
  before insert or update on public.specialist_visits
  for each row execute function public.validate_specialist_visit();

-- ---------------------------------------------------------------------
-- 4. Agendar (tudo ou nada: horário do especialista + sala)
-- ---------------------------------------------------------------------
create or replace function public.book_specialist(
  p_visit_id       uuid,
  p_starts_at      timestamptz,
  p_ends_at        timestamptz,
  p_subject        text,
  p_location       text,
  p_room_id        uuid    default null,
  p_external_place text    default '',
  p_guest_emails   text[]  default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  v       public.specialist_visits;
  emails  text[];
  bad     text;
  msg     text;
  room_bk uuid;
  new_id  uuid;
begin
  if uid is null or not public.is_active_user() then
    raise exception 'Você não tem permissão para fazer isso.' using errcode = '42501';
  end if;

  -- trava a visita: dois agendamentos simultâneos na mesma visita entram em fila
  select * into v from public.specialist_visits where id = p_visit_id for update;
  if not found then
    raise exception 'Essa agenda de especialista não existe mais.';
  end if;

  msg := public.specialist_window_error(v, p_starts_at, p_ends_at);
  if msg is not null then
    raise exception '%', msg;
  end if;
  if p_starts_at <= now() then
    raise exception 'Não é possível agendar um horário que já passou.';
  end if;
  if btrim(coalesce(p_subject, '')) = '' then
    raise exception 'Informe o assunto da reunião.';
  end if;

  if exists (
    select 1 from public.specialist_bookings b
    where b.visit_id = p_visit_id
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'O especialista já tem outro atendimento nesse horário. Escolha outro horário.';
  end if;

  select coalesce(array_agg(distinct lower(btrim(e))), '{}') into emails
  from unnest(coalesce(p_guest_emails, '{}')) as e
  where btrim(e) <> '';

  select e into bad from unnest(emails) as e where e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' limit 1;
  if bad is not null then
    raise exception 'E-mail inválido: %', bad;
  end if;
  if cardinality(emails) > 10 then
    raise exception 'Informe no máximo 10 e-mails extras.';
  end if;

  if p_location = 'office' then
    if p_room_id is null then
      raise exception 'Escolha a sala da reunião.';
    end if;
    begin
      -- passa pelas mesmas regras da agenda de salas (validate_booking e anti-sobreposição)
      insert into public.bookings (room_id, user_id, starts_at, ends_at, subject)
      values (
        p_room_id, uid, p_starts_at, p_ends_at,
        left('Especialista ' || v.specialist_name || ': ' || btrim(p_subject), 120)
      )
      returning id into room_bk;
    exception when exclusion_violation then
      raise exception 'A sala escolhida já está reservada nesse horário. Escolha outra sala.';
    end;
  elsif p_location <> 'external' then
    raise exception 'Informe se a reunião é no escritório ou fora.';
  end if;

  insert into public.specialist_bookings
    (visit_id, user_id, starts_at, ends_at, subject, location, room_booking_id, external_place, guest_emails)
  values (
    p_visit_id, uid, p_starts_at, p_ends_at, btrim(p_subject), p_location, room_bk,
    case when p_location = 'external' then left(btrim(coalesce(p_external_place, '')), 160) else '' end,
    emails
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Cancelar (o próprio agendamento; admin cancela qualquer um)
-- ---------------------------------------------------------------------
create or replace function public.cancel_specialist_booking(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select user_id into owner from public.specialist_bookings where id = p_id;
  if not found then
    raise exception 'Esse agendamento já foi cancelado.';
  end if;
  if not ((owner = auth.uid() and public.is_active_user()) or public.is_admin()) then
    raise exception 'Você só pode cancelar os seus próprios agendamentos.' using errcode = '42501';
  end if;
  delete from public.specialist_bookings where id = p_id; -- o trigger libera a sala
end;
$$;

revoke execute on function public.book_specialist(uuid, timestamptz, timestamptz, text, text, uuid, text, text[]) from public, anon;
revoke execute on function public.cancel_specialist_booking(uuid) from public, anon;
revoke execute on function public.release_specialist_room() from public, anon, authenticated;
revoke execute on function public.specialist_window_error(public.specialist_visits, timestamptz, timestamptz) from public, anon;
grant  execute on function public.specialist_window_error(public.specialist_visits, timestamptz, timestamptz) to authenticated;
grant  execute on function public.book_specialist(uuid, timestamptz, timestamptz, text, text, uuid, text, text[]) to authenticated;
grant  execute on function public.cancel_specialist_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Row Level Security
--    Visitas: todos os ativos veem; só admin cria, edita e exclui.
--    Agendamentos: todos os ativos veem; criar/cancelar só pelas funções acima.
-- ---------------------------------------------------------------------
alter table public.specialist_visits   enable row level security;
alter table public.specialist_bookings enable row level security;

revoke all on public.specialist_visits, public.specialist_bookings from anon;

drop policy if exists specialist_visits_select on public.specialist_visits;
create policy specialist_visits_select on public.specialist_visits
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists specialist_visits_insert_admin on public.specialist_visits;
create policy specialist_visits_insert_admin on public.specialist_visits
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists specialist_visits_update_admin on public.specialist_visits;
create policy specialist_visits_update_admin on public.specialist_visits
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists specialist_visits_delete_admin on public.specialist_visits;
create policy specialist_visits_delete_admin on public.specialist_visits
  for delete to authenticated using ((select public.is_admin()));

drop policy if exists specialist_bookings_select on public.specialist_bookings;
create policy specialist_bookings_select on public.specialist_bookings
  for select to authenticated using ((select public.is_active_user()));

-- ---------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['specialist_visits', 'specialist_bookings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
