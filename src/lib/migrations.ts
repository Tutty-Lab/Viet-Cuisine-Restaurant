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
  const id = "vietcuisine-monday-open-v1";
  if (_storeId !== "vietcuisine" || schedule.migrations?.includes(id)) return schedule;
  return { ...schedule, workHours: {
    ...schedule.workHours,
    perWeekday: { ...schedule.workHours.perWeekday, monday: [
      { startMinutes: 720, endMinutes: 840 }, { startMinutes: 1050, endMinutes: 1290 },
    ] },
    closedWeekdays: { ...schedule.workHours.closedWeekdays, monday: false },
  }, migrations: [...(schedule.migrations ?? []), id] };
}
