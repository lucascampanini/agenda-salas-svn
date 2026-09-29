-- =====================================================================
-- Agenda de Salas — SVN Investimentos (Campo Grande/MS)
-- Script completo: tabelas, constraint anti-sobreposição, validações,
-- RLS, trigger de perfis, Realtime e seed das 4 salas.
--
-- Como usar: Supabase > SQL Editor > New query > colar tudo > Run.
-- O script pode ser executado mais de uma vez sem duplicar dados.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. Configurações de funcionamento (linha única)
--    Para mudar o horário, veja o README ("Alterar horários").
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  id           boolean primary key default true check (id),
  timezone     text    not null default 'America/Campo_Grande',
  open_time    time    not null default '08:00',
  close_time   time    not null default '18:00',
  slot_minutes integer not null default 30 check (slot_minutes in (10, 15, 20, 30, 60)),
  constraint settings_open_before_close check (open_time < close_time),
  constraint settings_slots_fit check (
    (extract(epoch from (close_time - open_time))::integer / 60) % slot_minutes = 0
  )
);

insert into public.settings (id) values (true) on conflict (id) do nothing;

-- Precisão dos horários de reserva, em minutos (1 = qualquer minuto: 09:07 às 09:43).
-- slot_minutes acima só define o desenho da grade (linhas de 30 em 30).
alter table public.settings
  add column if not exists booking_step_minutes integer not null default 1
  check (booking_step_minutes in (1, 5, 10, 15, 30, 60));

-- ---------------------------------------------------------------------
-- 2. Perfis (1:1 com auth.users)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text        not null,
  email      text        not null,
  is_admin   boolean     not null default false,
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Salas
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null check (char_length(btrim(name)) between 1 and 60),
  position   integer     not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists rooms_name_unique on public.rooms (lower(btrim(name)));

-- ---------------------------------------------------------------------
-- 4. Reservas
--    A data da reserva é a data local de starts_at (America/Campo_Grande).
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid        not null references public.rooms (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  subject    text        not null check (char_length(btrim(subject)) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint bookings_time_order check (ends_at > starts_at),
  -- REGRA CENTRAL: nenhuma sobreposição de horário na mesma sala.
  -- '[)' = início incluso, fim excluso: 09:00–10:00 e 10:00–11:00 não conflitam.
  constraint bookings_no_overlap exclude using gist (
    room_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
);

create index if not exists bookings_starts_at_idx on public.bookings (starts_at);
create index if not exists bookings_user_starts_idx on public.bookings (user_id, starts_at);

-- ---------------------------------------------------------------------
-- 5. Validação de regras de negócio no banco
--    (dias úteis, horário de funcionamento, precisão de minutos, nada no passado)
-- ---------------------------------------------------------------------
create or replace function public.validate_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  s        public.settings;
  local_s  timestamp;
  local_e  timestamp;
  step_sec integer;
begin
  select * into s from public.settings where id;

  local_s  := new.starts_at at time zone s.timezone;
  local_e  := new.ends_at   at time zone s.timezone;
  step_sec := s.booking_step_minutes * 60;

  if new.starts_at <= now() then
    raise exception 'Não é possível reservar um horário que já passou.';
  end if;

  if extract(isodow from local_s) > 5 then
    raise exception 'As reservas só podem ser feitas de segunda a sexta.';
  end if;

  if local_s::date <> local_e::date
     or local_s::time < s.open_time
     or local_e::time > s.close_time then
    raise exception 'Horário fora do funcionamento (das % às %).',
      to_char(s.open_time, 'HH24:MI'), to_char(s.close_time, 'HH24:MI');
  end if;

  if extract(epoch from (local_s::time - s.open_time))::numeric % step_sec <> 0
     or extract(epoch from (local_e::time - s.open_time))::numeric % step_sec <> 0 then
    if s.booking_step_minutes = 1 then
      raise exception 'Use horários em minutos cheios (sem segundos).';
    end if;
    raise exception 'Início e fim devem ser múltiplos de % minutos.', s.booking_step_minutes;
  end if;

  new.subject := btrim(new.subject);
  return new;
end;
$$;

drop trigger if exists bookings_validate on public.bookings;
create trigger bookings_validate
  before insert or update on public.bookings
  for each row execute function public.validate_booking();

-- ---------------------------------------------------------------------
-- 6. Perfil criado automaticamente quando um usuário é criado
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, is_admin)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfis para usuários que já existiam antes deste script
insert into public.profiles (id, full_name, email)
select u.id,
       coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)),
       u.email
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 7. Funções auxiliares de permissão (usadas nas políticas RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and is_admin);
$$;

revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_admin()       from public, anon;
grant  execute on function public.is_active_user() to authenticated;
grant  execute on function public.is_admin()       to authenticated;

-- ---------------------------------------------------------------------
-- 8. Row Level Security
--    Visitantes não logados (anon) não enxergam nada.
--    Perfis só são alterados pela função serverless (service role).
-- ---------------------------------------------------------------------
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.bookings enable row level security;

revoke all on public.settings, public.profiles, public.rooms, public.bookings from anon;

-- settings: leitura para logados; ninguém altera pelo app
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated using (true);

-- profiles: usuários ativos veem todos os nomes (a agenda mostra quem reservou)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using ((select public.is_active_user()));

-- rooms: todos os ativos veem; só admin cria, renomeia e exclui
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated using ((select public.is_active_user()));

drop policy if exists rooms_insert_admin on public.rooms;
create policy rooms_insert_admin on public.rooms
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists rooms_update_admin on public.rooms;
create policy rooms_update_admin on public.rooms
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists rooms_delete_admin on public.rooms;
create policy rooms_delete_admin on public.rooms
  for delete to authenticated using ((select public.is_admin()));

-- bookings: todos os ativos veem a agenda completa
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated using ((select public.is_active_user()));

-- só cria reserva em nome próprio
drop policy if exists bookings_insert_own on public.bookings;
create policy bookings_insert_own on public.bookings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_active_user()));

-- cancela as próprias; admin cancela qualquer uma
drop policy if exists bookings_delete_own_or_admin on public.bookings;
create policy bookings_delete_own_or_admin on public.bookings
  for delete to authenticated
  using (
    (user_id = (select auth.uid()) and (select public.is_active_user()))
    or (select public.is_admin())
  );

-- Sem política de UPDATE em bookings: reservas não são editadas, só criadas/canceladas.

-- ---------------------------------------------------------------------
-- 9. Realtime (a agenda atualiza sozinha para todos)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['bookings', 'rooms', 'profiles'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Seed: 4 salas iniciais
-- ---------------------------------------------------------------------
insert into public.rooms (name, position)
select v.name, v.position
from (values ('Sala 1', 1), ('Sala 2', 2), ('Sala 3', 3), ('Sala 4', 4)) as v (name, position)
where not exists (select 1 from public.rooms);
