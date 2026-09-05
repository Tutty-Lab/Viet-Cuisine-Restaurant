// ============================================================================
// Einfache Passwortsperre – NUR eine Sichtblende, keine echte Sicherheit.
//
// Die App läuft komplett im Browser. Wer die Entwicklerwerkzeuge öffnet, kommt
// an alles heran; das Passwort hält nur zufällige Blicke ab, etwa wenn das
// Tablet im Laden offen liegt.
//
// Das Passwort steht deshalb NICHT mehr im Code, sondern als SHA-256-Hash im
// gespeicherten Zustand – damit wandert es über die Datenbank auf alle Geräte
// der Filiale, und jede Filiale setzt ihr eigenes. Solange keins gesetzt ist,
// gilt das Startpasswort.
//
// Gespeichert wird der Hash und nicht der Klartext. Das schützt nicht gegen
// jemanden, der die App auseinandernimmt, aber es verhindert, dass das
// Passwort beim Blick in die Datenbank einfach so dasteht – Leute benutzen
// dasselbe Passwort gern noch woanders.
// ============================================================================

import { loadState } from "./storage";

/** Gilt, solange die Filiale kein eigenes Passwort gesetzt hat. */
export const DEFAULT_PASSWORD = "1991";

/** Kürzestes zulässiges Passwort. */
export const MIN_PASSWORD_LENGTH = 4;

const AUTH_KEY = "stundenzettel-app:auth";

/** SHA-256 als Hex-String. */
export async function hashPassword(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stimmt das Passwort? Ohne gesetzten Hash gilt das Startpasswort.
 *
 * Der Hash kommt als Parameter herein, damit dieselbe Prüfung sowohl vor dem
 * Start (aus dem LocalStorage) als auch später aus dem React-Zustand laufen
 * kann, ohne zwei Wege durch dieselbe Logik zu haben.
 */
export async function passwordMatches(input: string, storedHash?: string): Promise<boolean> {
  if (!storedHash) return input === DEFAULT_PASSWORD;
  return (await hashPassword(input)) === storedHash;
}

export function isAuthenticated(): boolean {
  try {
    return localStorage.getItem(AUTH_KEY) === "ok";
  } catch {
    return false;
  }
}

/**
 * Prüft das Passwort beim Start und merkt sich den Login (bis „Đăng xuất").
 *
 * Läuft VOR dem React-Zustand und liest den Hash deshalb direkt aus dem
 * LocalStorage; die App schreibt ihn dort bei jeder Änderung mit.
 */
export async function login(password: string): Promise<boolean> {
  const ok = await passwordMatches(password, loadState()?.passwordHash);
  if (!ok) return false;
  try {
    localStorage.setItem(AUTH_KEY, "ok");
  } catch {
    /* ignorieren */
  }
  return true;
}

export function logout(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignorieren */
  }
}
