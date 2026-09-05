// ============================================================================
// Hilfsfunktionen rund um aufeinanderfolgende Arbeitstage.
// Datumsangaben sind ISO-Strings "yyyy-MM-dd".
// ============================================================================

import { addDays, differenceInCalendarDays, format } from "date-fns";
import { parseIsoDate } from "./demand";

export function isoAddDays(isoDate: string, amount: number): string {
  return format(addDays(parseIsoDate(isoDate), amount), "yyyy-MM-dd");
}

export function daysBetween(isoA: string, isoB: string): number {
  return differenceInCalendarDays(parseIsoDate(isoB), parseIsoDate(isoA));
}

/**
 * Länge der zusammenhängenden Arbeitstage-Kette, die entsteht, wenn candidate
 * zur bestehenden Menge worked hinzugefügt wird (candidate eingeschlossen).
 */
export function consecutiveRunLengthWith(worked: Set<string>, candidate: string): number {
  let length = 1;
  let cursor = isoAddDays(candidate, -1);
  while (worked.has(cursor)) {
    length++;
    cursor = isoAddDays(cursor, -1);
  }
  cursor = isoAddDays(candidate, 1);
  while (worked.has(cursor)) {
    length++;
    cursor = isoAddDays(cursor, 1);
  }
  return length;
}

/** Maximale Kette aufeinanderfolgender Arbeitstage in einer Datumsmenge. */
export function maxConsecutiveRun(dates: Iterable<string>): number {
  const sorted = [...dates].sort();
  let best = 0;
  let current = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    if (prev !== null && daysBetween(prev, date) === 1) {
      current++;
    } else {
      current = 1;
    }
    if (current > best) best = current;
    prev = date;
  }
  return best;
}

/**
 * Kleiner deterministischer PRNG (mulberry32) aus einem String-Seed.
 * Gleicher Seed => gleiche Zahlenfolge => reproduzierbare Pläne.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
