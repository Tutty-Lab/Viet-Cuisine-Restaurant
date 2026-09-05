-- ============================================================================
-- Ein Tisch für alle Filialen. Jede Filiale ist eine Zeile; der komplette
-- App-Zustand liegt als JSON darin – genau wie bisher im LocalStorage.
-- Dadurch teilen sich alle Repos (eine Filiale = ein Repo, eine Domain)
-- dieselbe Datenbank, ohne dass am Datenmodell etwas umgebaut werden muss.
-- ============================================================================

create table if not exists public.store_data (
  store_id   text primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- updated_at automatisch mitführen.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists store_data_touch on public.store_data;
create trigger store_data_touch
  before update on public.store_data
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- ACHTUNG – bewusste Entscheidung des Betreibers:
-- Die App läuft rein im Browser und hat keine Anmeldung. Der anon-Key steckt
-- im öffentlichen JavaScript. Diese Policy erlaubt daher jedem mit dem Key
-- Zugriff auf ALLE Filialen. Das ist so gewollt (Passwort 1991 ist nur eine
-- Sichtblende im Client).
--
-- Wenn später doch getrennt werden soll: Supabase Auth einschalten und diese
-- Policy durch eine ersetzen, die store_id gegen die Anmeldung prüft.
-- ----------------------------------------------------------------------------
alter table public.store_data enable row level security;

drop policy if exists store_data_open on public.store_data;
create policy store_data_open
  on public.store_data
  for all
  to anon, authenticated
  using (true)
  with check (true);
