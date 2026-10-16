// ============================================================================
// Persistenz via LocalStorage. Speichert Firma, Mitarbeiter, Monat, den
// generierten Plan sowie den ursprünglich generierten Plan (für "Zurücksetzen").
// ============================================================================

import type { Schedule, Shift } from "../types";

// Je Filiale ein eigener Schlüssel – sonst würde das Umschalten die Daten
// der anderen Filiale überschreiben.
const keyFor = (storeId: string) => `stundenzettel-app:v1:${storeId}`;
/** Schlüssel der alten Viet-Cuisine-App (ein Laden, ohne Filial-Suffix). */
const LEGACY_KEY = "stundenzettel-app:v1";

export type PersistedState = {
  schedule: Schedule;
  /**
   * SHA-256 des Filial-Passworts. Fehlt es, gilt das Startpasswort.
   * Liegt hier und nicht im Schedule, weil es zum LADEN gehört und nicht zu
   * einem einzelnen Monat – beim Monatswechsel darf es nicht verschwinden.
   */
  passwordHash?: string;
  /** Snapshot des zuletzt generierten Plans (für Reset). */
  originalShifts: Shift[];
};

export function loadState(storeId: string): PersistedState | null {
  try {
    // Geräte mit der alten App: deren Stand einmal übernehmen (gespeichert wird
    // danach unter dem neuen Schlüssel).
    const raw = localStorage.getItem(keyFor(storeId)) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.schedule) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(storeId: string, state: PersistedState): void {
  try {
    localStorage.setItem(keyFor(storeId), JSON.stringify(state));
  } catch {
    // Speicher voll / nicht verfügbar – im MVP still ignorieren.
  }
}

export function clearState(storeId: string): void {
  try {
    localStorage.removeItem(keyFor(storeId));
  } catch {
    // ignorieren
  }
}
