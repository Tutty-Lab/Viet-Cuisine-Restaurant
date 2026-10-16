// ============================================================================
// Einmalige Datenänderungen am GESPEICHERTEN Stand (LocalStorage und Supabase).
//
// Viet Cuisine hat derzeit keine. Neue Änderung: eigene Kennung anlegen, in
// applyMigrations prüfen und in schedule.migrations eintragen – so läuft sie
// genau EINMAL.
// ============================================================================

import type { Schedule } from "../types";

/** Wendet alle noch offenen Änderungen auf den Stand einer Filiale an. */
export function applyMigrations(_storeId: string, schedule: Schedule): Schedule {
  return schedule;
}
