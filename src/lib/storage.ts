// ============================================================================
// Persistenz via LocalStorage. Speichert Firma, Mitarbeiter, Monat, den
// generierten Plan sowie den ursprünglich generierten Plan (für "Zurücksetzen").
// ============================================================================

import type { Schedule, Shift } from "../types";

const STORAGE_KEY = "stundenzettel-app:v1";

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

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed?.schedule) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Speicher voll / nicht verfügbar – im MVP still ignorieren.
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignorieren
  }
}
