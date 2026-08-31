-- ============================================================================
-- CoSoft – Datenbankschema für Supabase (Postgres)
-- ============================================================================
-- Ausführen im Supabase Dashboard unter "SQL Editor" -> "New query" -> Inhalt
-- dieser Datei einfügen -> "Run". Einmalig pro Projekt.
--
-- Enthält:
--   1. Tabellen (Kunden, Mitglieder, Kanban-Spalten, Aufgaben, Termine)
--   2. Automatisches Profil bei Registrierung
--   3. Row Level Security (RLS) – jeder Nutzer sieht nur Kunden, denen er
--      zugeordnet ist. Das ist die Grundlage für "geschützt" + "Multiuser".
--   4. Trigger für die intelligente Verknüpfung: eine Aufgabe mit Fälligkeits-
--      datum erzeugt/aktualisiert automatisch einen Kalendertermin – und wenn
--      der Termin im Kalender verschoben wird, zieht das Fälligkeitsdatum der
--      Aufgabe automatisch nach (und umgekehrt).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. Profile (öffentlich sichtbarer Teil von auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_all_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid());

-- Bei jeder Neuregistrierung automatisch ein Profil anlegen
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. Kunden (= eigener Bereich mit eigenem Kanban-Board + eigener Terminplanung)
-- ----------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#6d5efc',
  created_at timestamptz not null default now()
);

create table if not exists public.customer_members (
  customer_id uuid not null references public.customers (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (customer_id, user_id)
);

-- Hilfsfunktion: ist der aktuell eingeloggte Nutzer diesem Kunden zugeordnet?
-- (security definer, damit sie in Policies ohne Rekursions-Deadlock nutzbar ist)
create or replace function public.is_customer_member(target_customer_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.customer_members m
    where m.customer_id = target_customer_id and m.user_id = auth.uid()
  );
$$;

alter table public.customers enable row level security;
alter table public.customer_members enable row level security;

-- Hinweis: owner_id = auth.uid() steht hier zusätzlich zu is_customer_member(id),
-- damit ein frisch per "INSERT ... RETURNING" angelegter Kunde sofort sichtbar
-- ist – die Mitgliedschaftszeile aus handle_new_customer() wird erst über einen
-- AFTER-ROW-Trigger am Ende der Anweisung geschrieben, also nach der
-- RETURNING/RLS-Prüfung dieser Einfüge-Anweisung.
create policy "customers_select_member"
  on public.customers for select
  to authenticated
  using (owner_id = auth.uid() or public.is_customer_member(id));

create policy "customers_insert_own"
  on public.customers for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "customers_update_owner"
  on public.customers for update
  to authenticated
  using (owner_id = auth.uid());

create policy "customers_delete_owner"
  on public.customers for delete
  to authenticated
  using (owner_id = auth.uid());

create policy "members_select_member"
  on public.customer_members for select
  to authenticated
  using (public.is_customer_member(customer_id));

create policy "members_delete_owner"
  on public.customer_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = auth.uid())
  );

-- Neuen Kunden anlegen: Ersteller wird automatisch Owner-Mitglied +
-- bekommt 4 Standard-Kanban-Spalten
create or replace function public.handle_new_customer()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.customer_members (customer_id, user_id, role)
  values (new.id, new.owner_id, 'owner');

  insert into public.board_columns (customer_id, name, position) values
    (new.id, 'Offen', 0),
    (new.id, 'In Arbeit', 1),
    (new.id, 'Review', 2),
    (new.id, 'Erledigt', 3);

  return new;
end;
$$;

-- Mitglied per E-Mail zu einem Kunden einladen (nur der Owner darf das).
-- security definer, weil dafür in auth.users nachgeschlagen werden muss.
create or replace function public.invite_member_by_email(target_customer_id uuid, member_email text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  found_user_id uuid;
begin
  if not exists (
    select 1 from public.customers where id = target_customer_id and owner_id = auth.uid()
  ) then
    raise exception 'Nur der Besitzer eines Kunden kann Mitglieder einladen.';
  end if;

  select id into found_user_id from auth.users where lower(email) = lower(member_email);

  if found_user_id is null then
    raise exception 'Kein Nutzer mit dieser E-Mail-Adresse registriert.';
  end if;

  insert into public.customer_members (customer_id, user_id, role)
  values (target_customer_id, found_user_id, 'member')
  on conflict (customer_id, user_id) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Kanban: Spalten + Aufgaben
-- ----------------------------------------------------------------------------
create table if not exists public.board_columns (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

drop trigger if exists on_customer_created on public.customers;
create trigger on_customer_created
  after insert on public.customers
  for each row execute function public.handle_new_customer();

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  column_id uuid not null references public.board_columns (id) on delete cascade,
  title text not null,
  description text,
  position int not null default 0,
  due_date date,
  priority text not null default 'normal' check (priority in ('niedrig', 'normal', 'hoch')),
  assignee_email text,
  done boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.board_columns enable row level security;
alter table public.tasks enable row level security;

create policy "columns_all_member"
  on public.board_columns for all
  to authenticated
  using (public.is_customer_member(customer_id))
  with check (public.is_customer_member(customer_id));

create policy "tasks_all_member"
  on public.tasks for all
  to authenticated
  using (public.is_customer_member(customer_id))
  with check (public.is_customer_member(customer_id));

-- ----------------------------------------------------------------------------
-- 4. Terminplanung (Kalender)
-- ----------------------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  title text not null,
  event_date date not null,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pro Aufgabe darf es höchstens einen automatisch verknüpften Termin geben
create unique index if not exists events_unique_task
  on public.events (task_id)
  where task_id is not null;

alter table public.events enable row level security;

create policy "events_all_member"
  on public.events for all
  to authenticated
  using (public.is_customer_member(customer_id))
  with check (public.is_customer_member(customer_id));

-- ----------------------------------------------------------------------------
-- 5. Intelligente Verknüpfung Aufgabe <-> Termin
-- ----------------------------------------------------------------------------

-- Aufgabe -> Termin: Fälligkeitsdatum gesetzt/geändert -> Termin anlegen/aktualisieren.
-- Fälligkeitsdatum entfernt -> automatisch erzeugten Termin löschen.
create or replace function public.sync_task_to_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.due_date is null then
    delete from public.events where task_id = new.id;
    return new;
  end if;

  -- Hinweis: OLD ist bei INSERT-Triggern nicht zugewiesen, daher hier explizit
  -- nach TG_OP verzweigen statt OLD in einer OR-Bedingung zu referenzieren.
  if tg_op = 'INSERT' then
    insert into public.events (customer_id, task_id, title, event_date, created_by)
    values (new.customer_id, new.id, new.title, new.due_date, new.created_by)
    on conflict (task_id) where task_id is not null
    do update set event_date = excluded.event_date, title = excluded.title;
    return new;
  end if;

  if old.due_date is distinct from new.due_date or old.title is distinct from new.title then
    insert into public.events (customer_id, task_id, title, event_date, created_by)
    values (new.customer_id, new.id, new.title, new.due_date, new.created_by)
    on conflict (task_id) where task_id is not null
    do update set
      event_date = excluded.event_date,
      title = excluded.title
      where public.events.event_date is distinct from excluded.event_date
         or public.events.title is distinct from excluded.title;
  end if;

  return new;
end;
$$;

drop trigger if exists on_task_change_sync_event on public.tasks;
create trigger on_task_change_sync_event
  after insert or update of due_date, title on public.tasks
  for each row execute function public.sync_task_to_event();

-- Termin -> Aufgabe: wird ein verknüpfter Termin im Kalender verschoben,
-- zieht das Fälligkeitsdatum der Aufgabe automatisch nach.
create or replace function public.sync_event_to_task()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.task_id is not null then
    update public.tasks
      set due_date = new.event_date
      where id = new.task_id
        and due_date is distinct from new.event_date;
  end if;
  return new;
end;
$$;

drop trigger if exists on_event_change_sync_task on public.events;
create trigger on_event_change_sync_task
  after update of event_date on public.events
  for each row execute function public.sync_event_to_task();

-- updated_at automatisch pflegen
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_tasks on public.tasks;
create trigger touch_tasks before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_events on public.events;
create trigger touch_events before update on public.events
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Realtime aktivieren (für Multi-Device-Sync in Echtzeit)
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.customer_members;
alter publication supabase_realtime add table public.board_columns;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.events;
