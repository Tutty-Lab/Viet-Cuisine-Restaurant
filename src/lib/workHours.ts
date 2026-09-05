// ============================================================================
// Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. Das ist das Fenster,
// in dem Schichten geplant werden dürfen (Früh am Fenster-Beginn, Spät am
// Fenster-Ende). Feiertage (Sachsen) werden für Nachfrage & Spätquote wie Sonntag
// behandelt, verwenden aber ihr eigenes Zeitfenster.
// ============================================================================

import { parseIsoDate, weekdayKeyOf, type WeekdayKey } from "./demand";

export type DayWindow = { startMinutes: number; endMinutes: number };

/**
 * Ein Arbeitstag kann aus MEHREREN Blöcken bestehen.
 *
 * Kylan öffnet Di–Fr zweimal am Tag (11:30–15:00 und 17:00–22:00). Früher gab
 * es je Wochentag nur ein Fenster; damit liess sich die Mittagsschliessung
 * nicht abbilden und der Scheduler plante mitten hinein. Ein Dienst muss immer
 * KOMPLETT in einen Block passen – über die Schliessung hinweg gibt es keine
 * Schicht.
 */
export type DayBlocks = DayWindow[];

export type WorkHoursConfig = {
  perWeekday: Record<WeekdayKey, DayBlocks>;
  holiday: DayBlocks;
  /**
   * Wochentage, an denen der Laden grundsätzlich geschlossen ist (kein Dienst).
   * Bei Kylan ist das der Montag. Ein Datum-Override mit eigenen Zeiten kann
   * einen solchen Tag im Einzelfall trotzdem öffnen.
   */
  closedWeekdays: Record<WeekdayKey, boolean>;
};

/**
 * Ausnahme für ein konkretes Datum (überschreibt Wochentag/Feiertag).
 * closed = an diesem Tag wird nicht geplant (z.B. Betriebsruhe);
 * window = abweichende Arbeitszeiten (z.B. halber Tag).
 */
export type DateOverride = {
  date: string; // ISO yyyy-MM-dd
  closed: boolean;
  window?: DayWindow;
  note?: string;
};

export type OverrideMap = Record<string, DateOverride>;

export type ResolvedDay = {
  closed: boolean;
  /** Die tatsächlichen Öffnungsblöcke, aufsteigend und ohne Überlappung. */
  blocks: DayBlocks;
  /** Äußerer Rahmen (erster Anfang bis letztes Ende) – für Anzeige und Summen. */
  window: DayWindow;
};

/** Rahmen um eine Liste von Blöcken. Leere Liste => 0-Fenster. */
export function frameOf(blocks: DayBlocks): DayWindow {
  if (blocks.length === 0) return { startMinutes: 0, endMinutes: 0 };
  return {
    startMinutes: Math.min(...blocks.map((b) => b.startMinutes)),
    endMinutes: Math.max(...blocks.map((b) => b.endMinutes)),
  };
}

/** Längster einzelner Block – so lang darf eine Schicht höchstens sein. */
export function longestBlock(blocks: DayBlocks): number {
  let max = 0;
  for (const b of blocks) max = Math.max(max, b.endMinutes - b.startMinutes);
  return max;
}

const w = (start: number, end: number): DayWindow => ({ startMinutes: start, endMinutes: end });

// Vorgabe des Betriebs (Viet Cuisine GmbH), Arbeitszeit:
//   Montag             geschlossen
//   Dienstag–Samstag   10:30–14:30 UND 16:30–22:30  (zwei Blöcke, Pause 14:30–16:30)
//   Sonntag & Feiertag 10:30–22:00 DURCHGEHEND (keine Mittagspause, ganzer Tag)
const MITTAGS_SPLIT: DayBlocks = [w(10 * 60 + 30, 14 * 60 + 30), w(16 * 60 + 30, 22 * 60 + 30)];
const DURCHGEHEND: DayBlocks = [w(10 * 60 + 30, 22 * 60)];

export const DEFAULT_WORK_HOURS: WorkHoursConfig = {
  perWeekday: {
    monday: MITTAGS_SPLIT.map((b) => ({ ...b })), // geschlossen, nur als Rückfall
    tuesday: MITTAGS_SPLIT.map((b) => ({ ...b })),
    wednesday: MITTAGS_SPLIT.map((b) => ({ ...b })),
    thursday: MITTAGS_SPLIT.map((b) => ({ ...b })),
    friday: MITTAGS_SPLIT.map((b) => ({ ...b })),
    saturday: MITTAGS_SPLIT.map((b) => ({ ...b })),
    // Sonntag durchgehend, ohne Mittagsschließung.
    sunday: DURCHGEHEND.map((b) => ({ ...b })),
  },
  // Feiertage werden wie Sonntag behandelt: der Laden ist OFFEN, durchgehend.
  holiday: DURCHGEHEND.map((b) => ({ ...b })),
  closedWeekdays: {
    monday: true, // Viet Cuisine: montags geschlossen
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  },
};

/**
 * Für Nachfrage/Spätquote maßgeblicher Wochentag: Feiertage zählen wie Sonntag
 * (der Nutzer gruppiert „Sonntag & Feiertag").
 */
export function effectiveWeekdayKey(isoDate: string, holidays: Set<string>): WeekdayKey {
  if (holidays.has(isoDate)) return "sunday";
  return weekdayKeyOf(parseIsoDate(isoDate));
}

/** Öffnungsblöcke für ein konkretes Datum (berücksichtigt Feiertage). */
export function resolveWorkBlocks(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
): DayBlocks {
  if (holidays.has(isoDate)) return config.holiday;
  return config.perWeekday[weekdayKeyOf(parseIsoDate(isoDate))];
}

const CLOSED: ResolvedDay = {
  closed: true,
  blocks: [],
  window: { startMinutes: 0, endMinutes: 0 },
};

const open = (blocks: DayBlocks): ResolvedDay => ({
  closed: false,
  blocks: [...blocks].sort((a, b) => a.startMinutes - b.startMinutes),
  window: frameOf(blocks),
});

/**
 * Vollständige Auflösung eines Tages inkl. Ausnahmen:
 * Ausnahme geschlossen > Ausnahme eigene Zeiten > geschlossener Wochentag
 * (z.B. Montag) > Feiertag > Wochentag.
 */
export function resolveDay(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
  overrides: OverrideMap = {},
): ResolvedDay {
  const ov = overrides[isoDate];
  if (ov?.closed) return CLOSED;
  // Ein Override mit eigenen Zeiten öffnet den Tag auch dann, wenn der
  // Wochentag sonst geschlossen wäre – dort gilt ein einzelner Block.
  if (ov?.window) return open([ov.window]);
  const weekday = weekdayKeyOf(parseIsoDate(isoDate));
  if (config.closedWeekdays?.[weekday]) return CLOSED;
  return open(resolveWorkBlocks(config, isoDate, holidays));
}

/** Ist der Laden an diesem Datum geschlossen? (für die Anzeige in der UI). */
export function isDayClosed(
  config: WorkHoursConfig,
  isoDate: string,
  holidays: Set<string>,
  overrides: OverrideMap = {},
): boolean {
  return resolveDay(config, isoDate, holidays, overrides).closed;
}

/** Ein einzelner Eintrag aus einem gespeicherten Stand als Blockliste. */
function blocksFrom(value: unknown, fallback: DayBlocks): DayBlocks {
  // Neuer Stand: bereits eine Liste.
  if (Array.isArray(value)) {
    const out = value.filter(
      (b): b is DayWindow =>
        !!b && typeof b.startMinutes === "number" && typeof b.endMinutes === "number",
    );
    if (out.length > 0) return out.map((b) => ({ ...b }));
    return fallback.map((b) => ({ ...b }));
  }
  // Alter Stand: EIN Fenster als Objekt – wird zu einer Liste mit einem Block.
  const one = value as DayWindow | undefined;
  if (one && typeof one.startMinutes === "number" && typeof one.endMinutes === "number") {
    return [{ startMinutes: one.startMinutes, endMinutes: one.endMinutes }];
  }
  return fallback.map((b) => ({ ...b }));
}

/**
 * Tiefe Kopie mit Auffüllen fehlender Felder.
 *
 * Wandelt dabei alte Speicherstände mit genau EINEM Fenster je Wochentag in
 * die Blockliste um. Ohne diesen Schritt käme aus der Datenbank ein Objekt,
 * wo der Code eine Liste erwartet, und der Tag wäre lautlos ohne Öffnung.
 */
export function normalizeWorkHours(partial: Partial<WorkHoursConfig> | undefined): WorkHoursConfig {
  const base = DEFAULT_WORK_HOURS;
  const perWeekday = {} as Record<WeekdayKey, DayBlocks>;
  for (const key of Object.keys(base.perWeekday) as WeekdayKey[]) {
    perWeekday[key] = blocksFrom(partial?.perWeekday?.[key], base.perWeekday[key]);
  }
  const holiday = blocksFrom(partial?.holiday, base.holiday);

  const closedWeekdays = { ...base.closedWeekdays };
  if (partial?.closedWeekdays) {
    for (const key of Object.keys(closedWeekdays) as WeekdayKey[]) {
      const v = partial.closedWeekdays[key];
      if (typeof v === "boolean") closedWeekdays[key] = v;
    }
  }
  return { perWeekday, holiday, closedWeekdays };
}
