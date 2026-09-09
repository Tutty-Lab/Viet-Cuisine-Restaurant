// ============================================================================
// Deterministischer, greedy Scheduler (kein Solver, kein KI-Modell).
//
// Vorgehen:
//  1. Alle Tage des Monats + Nachfrage-Gewichte -> rohes Tages-Soll (Minuten).
//  2. Sollstunden jedes Mitarbeiters in Schicht-Token zerlegen.
//  3. Token rundenweise (rotierend) verteilen; große Vollzeit-Schichten zuerst.
//  4. Für jedes Token die beste Kalender-Datum wählen (Score + harte Regeln).
//  5. Früh/Spät anhand der gewünschten Spätschicht-Quote wählen.
//  6. Reparaturlauf: Schichten zwischen Tagen verschieben, um die Tages-
//     nachfrage besser zu treffen (Sollstunden bleiben exakt erhalten).
//
// Harte Regeln, die IMMER eingehalten werden:
//  - genau ein Dienst pro Mitarbeiter und Tag
//  - höchstens 6 aufeinanderfolgende Arbeitstage
//  - Token-Dauer wird nie verändert  => monatliches Soll bleibt exakt
// ============================================================================

import type { Employee, Shift } from "../types";
import {
  DAY_WEIGHTS,
  LATE_SHIFT_RATIOS,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "./demand";
import { getShiftTemplate, type TemplateType } from "./shifts";
import { consecutiveRunLengthWith, seededRandom } from "./consecutive";
import { mayWorkOn } from "./availability";
import { monthlyTargetMinutes, weeklyTargetMinutes } from "./contract";
import { weekStartOf } from "./weeks";
import {
  AZUBI_EVENING_END,
  AZUBI_EVENING_START,
  OWNER_DAYS_PER_WEEK,
  OWNER_FREE_WEEKDAY,
  OWNER_MAX_SHIFT_HOURS,
} from "../types";
import { calculatePause, presenceFromPaid } from "./time";
import {
  effectiveWeekdayKey,
  frameOf,
  longestBlock,
  resolveDay,
  type DayBlocks,
  type DayWindow,
  type ResolvedDay,
  type OverrideMap,
  type WorkHoursConfig,
} from "./workHours";
import { publicHolidays } from "./holidays";
import { generateWeeklySchedule } from "./weeklyScheduler";
import { CLOSING_MAX, CLOSING_MIN, CLOSING_START, coveragePoints, workingAt } from "./staffing";

export type GenerateInput = {
  year: number;
  month: number; // 1-basiert
  /** Arbeitszeit-Fenster je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  overrides?: OverrideMap;
  employees: Employee[];
  /** Feiertage als ISO-Set; Standard: Sachsen-Feiertage des Jahres. */
  holidays?: Set<string>;
  /** Optionaler Seed; sonst aus Eingabedaten abgeleitet. */
  seed?: string;
};

type DateState = {
  totalPaid: number;
  latePaid: number;
  count: number;
};

type SchedulerState = {
  dates: string[];
  rawTarget: Map<string, number>; // ISO -> rohes Tages-Soll in Minuten
  dateState: Map<string, DateState>;
  worked: Map<string, Set<string>>; // employeeId -> Set<ISO>
  /** IDs der Chefs – für sie gelten eigene Regeln (siehe ownerDayOk). */
  owners: Set<string>;
  /** Mitarbeiter nach id – für Spanne und Schichtlänge beim Tauschen. */
  byId: Map<string, Employee>;
  weekendCount: Map<string, number>; // employeeId -> Anzahl Fr/Sa-Schichten
  remaining: Map<string, number>; // employeeId -> noch zu verplanende Minuten
  /**
   * Wochen-Soll je Mitarbeiter: employeeId -> (weekStart -> Minuten). Nur für
   * Kräfte mit Wochenvertrag (weeklyHours) gefüllt; sonst leer = keine
   * Wochen-Deckelung, das Monats-Soll verteilt sich frei wie bisher.
   */
  weekTarget: Map<string, Map<string, number>>;
  shifts: Shift[];
  /** Für Nachfrage/Spätquote maßgeblicher Wochentag (Feiertag = Sonntag). */
  effKeyOf: (isoDate: string) => WeekdayKey;
  /** Aufgelöster Tag (geschlossen? + Arbeitszeit-Fenster) für ein Datum. */
  dayOf: (isoDate: string) => ResolvedDay;
  /** Stoßzeiten dieses Datums – je Wochentag verschieden. */
  peaksOf: (isoDate: string) => readonly PeakWindow[];
  rng: () => number;
  /** true = Schichtlängen mischen; false = immer die längste (Rückfallmodus). */
  varyLengths: boolean;
  /**
   * true = Wochen-Soll hart deckeln (Normalfall, hält jede Woche nahe an den
   * Wochenstunden). false = Deckel gelöst; letzter Rückfall, wenn eine Woche
   * durch verkürzte Tage (Override/Feiertag) nicht genug Kapazität hat und das
   * MONATS-Soll sonst offen bliebe. Ein exakt getroffenes Monats-Soll geht vor
   * einer perfekten Wochenverteilung.
   */
  enforceWeekCap: boolean;
};

/**
 * Längster zusammenhängender Block des Tages (0 wenn geschlossen).
 *
 * Maßgeblich ist der längste EINZELNE Block, nicht der Rahmen von der ersten
 * Öffnung bis zur letzten Schließung: eine Schicht muss komplett in einen
 * Block passen. Bei 11:30–15:00 und 17:00–22:00 sind das 5 h, nicht 10,5 h.
 */
function windowLength(day: ResolvedDay): number {
  return day.closed ? 0 : longestBlock(day.blocks);
}

/**
 * Welche Öffnungsblöcke stehen dieser Person an diesem Tag offen?
 *
 * Für alle außer dem Azubi sind das die Blöcke des Tages. Der Azubi kommt
 * unter der Woche nur abends (18–22 Uhr); an Samstag und Sonntag gilt die
 * Einschränkung nicht, dort ist der ganze Tag offen.
 *
 * Geschnitten wird der BLOCK, nicht die Schicht: aus dem Abendblock 17–22 wird
 * für ihn 18–22. Damit greifen alle weiteren Rechnungen – Schichtlänge,
 * Kapazität, Anordnung – automatisch auf das engere Fenster zu, statt dass an
 * jeder Stelle eine Sonderprüfung stehen müsste.
 */
function blocksFor(day: ResolvedDay, employee: Employee | undefined, isoDate: string): DayBlocks {
  if (!employee || employee.employmentType !== "AZUBI") return day.blocks;

  const wochentag = weekdayKeyOf(parseIsoDate(isoDate));
  if (wochentag === "saturday" || wochentag === "sunday") return day.blocks;

  const abends: DayBlocks = [];
  for (const b of day.blocks) {
    const von = Math.max(b.startMinutes, AZUBI_EVENING_START);
    const bis = Math.min(b.endMinutes, AZUBI_EVENING_END);
    if (bis - von >= MIN_SHIFT_MINUTES) abends.push({ startMinutes: von, endMinutes: bis });
  }
  return abends;
}

/**
 * Wie lang ist der Tag FÜR DIESE PERSON? Für den Chef der ganze Rahmen, für
 * alle anderen der längste einzelne Öffnungsblock (siehe
 * OWNER_MAX_SHIFT_HOURS).
 */
function spanFor(day: ResolvedDay, employee?: Employee, isoDate?: string): number {
  if (day.closed) return 0;
  if (employee?.isOwner) {
    const rahmen = frameOf(day.blocks);
    return rahmen.endMinutes - rahmen.startMinutes;
  }
  const bloecke = isoDate ? blocksFor(day, employee, isoDate) : day.blocks;
  return bloecke.length === 0 ? 0 : longestBlock(bloecke);
}

/** Längste zulässige Schicht dieser Person in Stunden. */
function maxHoursFor(employee?: Employee): number {
  return employee?.isOwner ? OWNER_MAX_SHIFT_HOURS : MAX_SHIFT_HOURS;
}


let shiftIdCounter = 0;
function nextShiftId(): string {
  shiftIdCounter += 1;
  return `gen-${shiftIdCounter}`;
}

function isWeekend(isoDate: string): boolean {
  const key = weekdayKeyOf(parseIsoDate(isoDate));
  return key === "friday" || key === "saturday";
}

// 10 h steht drin, weil der Chef so lange arbeitet. Für alle anderen greift
// maxHoursFor() und deckelt bei 9 – siehe OWNER_MAX_SHIFT_HOURS.
const SHIFT_HOURS_DESC = [10, 9, 8, 7, 6, 5, 4, 3] as const;

/** Längste zulässige Schicht in Stunden (bezahlt, ohne Pause). */
const MAX_SHIFT_HOURS = 9;

/** Kürzeste zulässige Schicht in Minuten – darunter geht ein Soll nicht auf. */
const MIN_SHIFT_MINUTES = 3 * 60;

/**
 * Erlaubte Schichtlängen je Anstellungsart (Vorgabe des Chefs).
 *
 * Vollzeit macht lange Dienste (6..9 h), Teilzeit die volle Bandbreite.
 *
 * Es gab zwischenzeitlich ein Kurzschicht-Budget, das einen langen Dienst
 * gelegentlich durch zwei kurze ersetzt hat (8 h -> 4 h + 4 h), damit die
 * Pläne abwechslungsreicher aussehen. Das ist wieder draußen: der Laden hat
 * drei Beschäftigte, da soll der Plan bewusst gleichförmig bleiben. Jede
 * Abwechslung kostet hier Besetzung in der Stoßzeit.
 */
const ALLOWED_HOURS: Record<Employee["employmentType"], readonly number[]> = {
  // 10 h stehen hier nur für den Chef zur Verfügung – begrenzt wird das nicht
  // hier, sondern über maxHoursFor(): für alle anderen bleibt bei 9 Schluss.
  VOLLZEIT: [4, 5, 6, 7, 8, 9, 10],
  TEILZEIT: [3, 4, 5, 6, 7, 8, 9],
  // Minijob ist arbeitsrechtlich eine Form der Teilzeit – gleiche Längen.
  // Begrenzt wird er über das Monats-Soll, nicht über die Schichtlänge.
  MINIJOB: [3, 4, 5, 6, 7, 8, 9],
  // Azubi: unter der Woche nur 18–22 Uhr, also höchstens 4 h; am Wochenende
  // ist der Tag offen, deshalb bleiben längere Schichten zulässig.
  AZUBI: [3, 4, 5, 6, 7, 8, 9],
};

/**
 * Wie oft darf eine Schicht bewusst kurz ausfallen (4 oder 5 h)?
 *
 * Vorgabe des Chefs: „nur etwa jede zehnte". Ganz ohne kurze Dienste sieht
 * jeder Monat gleich aus; zu viele davon kosten Besetzung in der Stoßzeit.
 * Greift nur, wenn der Tag ohnehin keinen langen Dienst mehr braucht und
 * genügend Reservetage übrig sind – das Monats-Soll bleibt in jedem Fall exakt.
 */
const SHORT_SHIFT_CHANCE = 0.1;

/** Längen, die als „kurze Schicht" im Sinne der 10-%-Regel gelten. */
const SHORT_SHIFT_HOURS: readonly number[] = [4, 5];

/** Alle überhaupt zulässigen Längen – Rückfall, wenn das Fenster eng ist. */
const ALL_HOURS: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 10];

// ── Stoßzeiten (peak windows) ───────────────────────────────────────────────
// Vorgabe der Chefin (Kylan): die Spitze liegt NICHT jeden Tag gleich.
//   Di–Fr  vormittags voll   -> 11:30–15:00
//   Sa/So  abends voll       -> 17:00–22:00
// In der Spitze dürfen HÖCHSTENS FÜNF Leute da sein, den Chef mitgezählt.
// Angabe des Betriebs: "wenn viel los ist höchstens 5, normal 3–4". Die 3–4
// sind eine Beschreibung, keine Vorschrift – festgehalten wird nur die
// Obergrenze. Eine Untergrenze von zwei gibt es NICHT: gefordert ist nur, dass
// überhaupt jemand da ist.
export type PeakWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** So viele müssen mindestens da sein. */
  minStaff: number;
  /** So viele dürfen höchstens da sein (inklusive Chef). */
  maxStaff: number;
};

// Sonntagsmittag ist stark ("buổi trưa chủ nhật đông"); an den anderen Tagen
// ist mittags wenig los ("còn lại vắng"), deshalb dort keine Mittagsspitze.
const SONNTAG_MITTAG: PeakWindow = {
  label: "Trưa CN",
  startMinutes: 12 * 60,
  endMinutes: 14 * 60,
  minStaff: 6,
  maxStaff: 12, // keine echte Obergrenze – der Betrieb hat keine genannt
};

// Angabe des Betriebs: die Stoßzeit liegt 18:00–20:00 ("thời điểm quán đông").
// Dieselben Zeiten steuern concentrateEveningShifts: kurze Abenddienste enden
// an EVENING_RUSH_END (20:00) statt am Schließen (22:30), damit sie auf der
// Spitze liegen; das Schließen deckt ein langer Dienst ab.
export const EVENING_RUSH_START = 18 * 60; // 18:00
export const EVENING_RUSH_END = 20 * 60; // 20:00

// Preferred earlier end for shifts not needed in the 21:30 closing team.
export const EVENING_TAPER_END = 21 * 60 + 30; // 21:30

const normalEvening = (minStaff: number): PeakWindow => ({
  label: "Tối",
  startMinutes: EVENING_RUSH_START,
  endMinutes: EVENING_RUSH_END,
  minStaff,
  maxStaff: 12, // keine echte Obergrenze – der Betrieb hat keine genannt
});

// Beim ÖFFNEN sollen mindestens zwei Kräfte da sein ("giờ mở cửa ít nhất 2 bạn")
// – zum Aufsperren, Vorbereiten und für die erste Bedienung.
const AUFSPERREN: PeakWindow = {
  label: "Mở cửa",
  startMinutes: 10 * 60 + 30, // 10:30 Ladenöffnung
  endMinutes: 11 * 60 + 30,
  minStaff: 2,
  maxStaff: 12,
};

const ABEND_AUFSPERREN: PeakWindow = {
  label: "Đầu ca tối", startMinutes: 16 * 60 + 30, endMinutes: 17 * 60 + 30,
  minStaff: 2, maxStaff: 12,
};

const MITTAG_SCHLUSS: PeakWindow = {
  label: "Cuối ca trưa", startMinutes: 14 * 60, endMinutes: 14 * 60 + 30,
  minStaff: 2, maxStaff: 12,
};

// Closing team requested by the business: five to six people from 21:30.
const SCHLUSS: PeakWindow = {
  label: "Đóng cửa",
  startMinutes: CLOSING_START,
  endMinutes: 22 * 60 + 30, // 22:30 Ladenschluss
  minStaff: CLOSING_MIN,
  maxStaff: CLOSING_MAX,
};

/**
 * Stoßzeiten je Wochentag. Montag ist geschlossen, steht aber der
 * Vollständigkeit halber drin (ein Datum-Override kann den Tag öffnen).
 * Feiertage werden wie Sonntag behandelt – siehe effectiveWeekdayKey.
 */
export const PEAK_WINDOWS_BY_WEEKDAY: Record<WeekdayKey, readonly PeakWindow[]> = {
  monday: [],
  tuesday: [AUFSPERREN, MITTAG_SCHLUSS, ABEND_AUFSPERREN, normalEvening(4), SCHLUSS],
  wednesday: [AUFSPERREN, MITTAG_SCHLUSS, ABEND_AUFSPERREN, normalEvening(4), SCHLUSS],
  thursday: [AUFSPERREN, MITTAG_SCHLUSS, ABEND_AUFSPERREN, normalEvening(4), SCHLUSS],
  friday: [AUFSPERREN, MITTAG_SCHLUSS, ABEND_AUFSPERREN, normalEvening(6), SCHLUSS],
  saturday: [AUFSPERREN, MITTAG_SCHLUSS, ABEND_AUFSPERREN, normalEvening(6), SCHLUSS],
  // Sonntag (und Feiertag, siehe effectiveWeekdayKey): zusätzlich Mittagsspitze.
  sunday: [AUFSPERREN, SONNTAG_MITTAG, normalEvening(6), SCHLUSS],
};

/** Wie viele Leute sind zum Zeitpunkt `t` anwesend (Anwesenheit inkl. Pause)? */
function coverageAt(shifts: Shift[], t: number): number {
  return new Set(shifts.filter((shift) => workingAt(shift, t)).map((shift) => shift.employeeId)).size;
}

/**
 * Kleinste Besetzung im halboffenen Intervall [from, to).
 * Die Besetzung ändert sich nur an Schichtgrenzen, deshalb genügt es, den
 * Anfang und jede Grenze innerhalb des Intervalls zu prüfen.
 */
export function minCoverageOver(shifts: Shift[], from: number, to: number): number {
  const probes = coveragePoints(shifts, from, to).slice(0, -1);
  let min = Number.POSITIVE_INFINITY;
  for (const t of probes) min = Math.min(min, coverageAt(shifts, t));
  return Number.isFinite(min) ? min : 0;
}

/**
 * Größte Besetzung im halboffenen Intervall [from, to).
 * Gegenstück zu minCoverageOver – für die Obergrenze ("höchstens zwei").
 */
export function maxCoverageOver(shifts: Shift[], from: number, to: number): number {
  const probes = coveragePoints(shifts, from, to).slice(0, -1);
  let max = 0;
  for (const t of probes) max = Math.max(max, coverageAt(shifts, t));
  return max;
}

/**
 * Wie weit liegt der Tag neben der erlaubten Besetzung der Stoßzeiten?
 *
 * Gezählt wird BEIDES: fehlende Personen und zu viele. Der Laden ist klein –
 * "höchstens zwei, den Chef mitgerechnet" ist genauso eine Vorgabe wie
 * "mindestens zwei". Weil Anordnung und Reparatur alle über diese eine Zahl
 * gesteuert werden, wirkt die Obergrenze damit überall, ohne dass jede
 * Funktion sie einzeln kennen muss.
 *
 * 0 = alle Spitzen des Tages liegen im erlaubten Band. Spitzen, die gar nicht
 * ins Arbeitszeit-Fenster fallen, zählen nicht mit.
 */
export function peakDeficit(
  shifts: Shift[],
  window: { startMinutes: number; endMinutes: number },
  peaks: readonly PeakWindow[],
): number {
  let off = 0;
  for (const peak of peaks) {
    const from = Math.max(peak.startMinutes, window.startMinutes);
    const to = Math.min(peak.endMinutes, window.endMinutes);
    if (to <= from) continue; // Spitze liegt außerhalb der Arbeitszeit
    off += Math.max(0, peak.minStaff - minCoverageOver(shifts, from, to));
    off += Math.max(0, maxCoverageOver(shifts, from, to) - peak.maxStaff);
  }
  return off;
}

/**
 * Lässt sich `hours` restlos in Schichten aus `allowed` zerlegen?
 * Nötig, weil z.B. 11 h mit nur 6/7/8-h-Schichten nicht aufgeht – ohne diese
 * Prüfung liefe der Scheduler in eine Sackgasse und das Soll bliebe offen.
 */
const decomposeCache = new Map<string, boolean>();
function canDecompose(hours: number, allowed: readonly number[]): boolean {
  if (hours === 0) return true;
  if (hours < Math.min(...allowed)) return false;

  // Schlüssel über die WERTE, nicht die Länge: zwei verschiedene Längenmengen
  // mit gleich vielen Einträgen hätten sonst denselben Cache-Eintrag.
  const key = `${allowed.join(",")}:${hours}`;
  const cached = decomposeCache.get(key);
  if (cached !== undefined) return cached;

  let ok = false;
  for (const h of allowed) {
    if (canDecompose(hours - h, allowed)) {
      ok = true;
      break;
    }
  }
  decomposeCache.set(key, ok);
  return ok;
}

/** Längstmögliche Schicht je Anstellungsart – für die Kapazitätsrechnung. */
const PREFERRED_HOURS: Record<Employee["employmentType"], number> = {
  VOLLZEIT: MAX_SHIFT_HOURS,
  TEILZEIT: MAX_SHIFT_HOURS,
  MINIJOB: MAX_SHIFT_HOURS,
  AZUBI: MAX_SHIFT_HOURS,
};

/** Größte Schichtlänge (Stunden), deren Anwesenheit noch ins Fenster passt (0 = keine). */
export function maxShiftHoursForWindow(windowMinutes: number): number {
  for (const hours of SHIFT_HOURS_DESC) {
    if (presenceFromPaid(hours * 60) <= windowMinutes) return hours;
  }
  return 0;
}

/**
 * Kürzeste Schichtlänge (Stunden), deren Anwesenheit mindestens `presence`
 * Minuten abdeckt. 0 = selbst die längste Schicht reicht nicht.
 */
export function shiftHoursForPresence(presenceMinutes: number): number {
  for (let i = SHIFT_HOURS_DESC.length - 1; i >= 0; i--) {
    const hours = SHIFT_HOURS_DESC[i];
    if (presenceFromPaid(hours * 60) >= presenceMinutes) return hours;
  }
  return 0;
}

/**
 * Wie viele bezahlte Minuten braucht ein Tag mindestens, damit die Stoßzeit
 * überhaupt besetzt werden KANN?
 *
 * Hintergrund: Früh hängt am Öffnen, Spät am Schließen. Eine Frühschicht deckt
 * die Stoßzeit nur, wenn sie bis zu deren Ende reicht; eine Spätschicht nur,
 * wenn sie vor deren Beginn anfängt. Bei 10:00–20:00 und einer Stoßzeit von
 * 12 bis 18 Uhr heißt das: beide brauchen 8 h Anwesenheitsspanne, also je eine
 * 8-h-Schicht. Zwei Personen => 16 h an dem Tag.
 *
 * Ohne diesen Boden verteilt die Gewichtung ruhigen Tagen so wenig Stunden,
 * dass dort nur kurze Dienste möglich sind – und die decken die Stoßzeit nie,
 * egal wie man sie schiebt.
 */
function peakFloorMinutes(day: ResolvedDay, peaks: readonly PeakWindow[]): number {
  if (day.closed) return 0;
  return cheapestPeakCover(day.blocks, peaks).reduce((sum, h) => sum + h * 60, 0);
}

const coverCache = new Map<string, number[]>();

/**
 * Billigste Kombination von Schichtlängen, mit der ein Tag ALLES erfüllt:
 * jemand sperrt auf, jemand sperrt zu, und die Stoßzeit ist durchgehend
 * besetzt. Ergebnis in Stunden, absteigend. Leer = gar nicht abdeckbar.
 *
 * Warum gesucht statt gerechnet: die naheliegende Formel „jeder Dienst muss
 * vom Öffnen bis zum Ende der Stoßzeit reichen" ergibt bei 10–20 Uhr und
 * Stoßzeit 12–18 Uhr zweimal 8 h = 16 h. Billiger geht es aber mit 9 h + 6 h
 * = 15 h: der 9-h-Dienst füllt das ganze Fenster und erledigt Aufsperren,
 * Zusperren und Stoßzeit in einem, der 6-h-Dienst stellt sich einfach mitten
 * hinein. Solche Kombinationen findet man nur, wenn man sie durchprobiert –
 * und zwar mit derselben Anordnungslogik, die später auch real läuft.
 */
export function cheapestPeakCover(blocks: DayBlocks, peaks: readonly PeakWindow[]): number[] {
  const key =
    blocks.map((b) => `${b.startMinutes}-${b.endMinutes}`).join("+") +
    "|" +
    peaks.map((p) => `${p.startMinutes}-${p.endMinutes}x${p.minStaff}-${p.maxStaff}`).join(",");
  const cached = coverCache.get(key);
  if (cached) return cached;

  // Eine Schicht muss komplett in EINEN Block passen.
  const span = longestBlock(blocks);
  const usable = ALL_HOURS.filter((h) => presenceFromPaid(h * 60) <= span);

  let found: number[] = [];
  // Nach Anzahl der Dienste aufsteigend, innerhalb nach Gesamtstunden.
  for (let count = 1; count <= 4 && found.length === 0; count++) {
    let bestTotal = Number.POSITIVE_INFINITY;
    let best: number[] | null = null;
    const combo: number[] = [];

    const recurse = (from: number) => {
      if (combo.length === count) {
        const total = combo.reduce((a, b) => a + b, 0);
        if (total < bestTotal && canCoverDay(blocks, combo, peaks)) {
          bestTotal = total;
          best = [...combo];
        }
        return;
      }
      for (let i = from; i < usable.length; i++) {
        combo.push(usable[i]);
        recurse(i); // Wiederholungen erlaubt
        combo.pop();
      }
    };
    recurse(0);

    if (best) found = (best as number[]).slice().sort((a, b) => b - a);
  }

  coverCache.set(key, found);
  return found;
}

/** Lässt sich der Tag mit genau diesen Längen vollständig abdecken? */
function canCoverDay(blocks: DayBlocks, hours: number[], peaks: readonly PeakWindow[]): boolean {
  const probe: Shift[] = hours.map((h, i) => ({
    id: `probe-${i}`,
    employeeId: `probe-${i}`,
    date: "probe",
    startMinutes: blocks[0].startMinutes,
    endMinutes: blocks[0].startMinutes + presenceFromPaid(h * 60),
    pauseMinutes: h * 60 - h * 60 + (presenceFromPaid(h * 60) - h * 60),
    paidMinutes: h * 60,
    shiftType: "EARLY",
    generated: true,
  }));

  arrangeForPeaks(blocks, probe, peaks);

  const frame = frameOf(blocks);
  const opens = probe.some((s) => s.startMinutes === frame.startMinutes);
  const closes = probe.some((s) => s.endMinutes === frame.endMinutes);
  return opens && closes && peakDeficit(probe, frameOf(blocks), peaks) === 0;
}

/** Bezahlte Stunden aller Dienste eines Tages. */
function dayPaidHours(state: SchedulerState, isoDate: string): number[] {
  const out: number[] = [];
  for (const s of state.shifts) if (s.date === isoDate) out.push(s.paidMinutes / 60);
  return out;
}

/**
 * Wie viele Anforderungen der billigsten Abdeckung deckt diese Menge von
 * Schichtlängen ab? Lange Dienste werden zuerst auf die größte offene
 * Anforderung gelegt.
 */
function coverFilledBy(cover: readonly number[], hours: number[]): number {
  const need = [...cover];
  let filled = 0;
  for (const h of [...hours].sort((a, b) => b - a)) {
    const idx = need.findIndex((n) => h >= n);
    if (idx >= 0) {
      need.splice(idx, 1);
      filled++;
    }
  }
  return filled;
}

/** Abdeckung eines Tages, wenn er GENAU diese Schichtlängen hätte. */
function coverFilledFor(state: SchedulerState, isoDate: string, hours: number[]): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return Number.POSITIVE_INFINITY;
  const cover = cheapestPeakCover(day.blocks, state.peaksOf(isoDate));
  if (cover.length === 0) return Number.POSITIVE_INFINITY;
  return coverFilledBy(cover, hours);
}

/** Wie viele Dienste verlangt die billigste Abdeckung an diesem Tag? */
function coverSize(state: SchedulerState, isoDate: string): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;
  return cheapestPeakCover(day.blocks, state.peaksOf(isoDate)).length;
}

/**
 * Welche Länge fehlt diesem Tag noch, um die billigste Abdeckung zu erreichen?
 * 0 = der Tag hat schon genug passende Dienste.
 */
function missingCoverHours(state: SchedulerState, isoDate: string): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;
  const need = [...cheapestPeakCover(day.blocks, state.peaksOf(isoDate))];
  if (need.length === 0) return 0;

  for (const h of dayPaidHours(state, isoDate).sort((a, b) => b - a)) {
    const idx = need.findIndex((n) => h >= n);
    if (idx >= 0) need.splice(idx, 1);
  }
  return need.length === 0 ? 0 : Math.max(...need);
}

/**
 * Wie lang darf ein Dienst höchstens sein, wenn er eine Stoßzeit KOMPLETT
 * meiden soll? Das ist die längste Lücke, die neben dem Fenster noch übrig
 * bleibt – in irgendeinem Block des Tages.
 *
 * Samstag 13–22 Uhr mit Spitze 17–22: davor bleiben 4 h, danach nichts.
 * Dienstag 11:30–15 + 17–22 mit Spitze am Vormittag: der ganze Abendblock,
 * also 5 h.
 */
function dodgeLimitMinutes(blocks: DayBlocks, peak: PeakWindow): number {
  let best = 0;
  for (const b of blocks) {
    const vor = Math.min(b.endMinutes, peak.startMinutes) - b.startMinutes;
    const nach = b.endMinutes - Math.max(b.startMinutes, peak.endMinutes);
    best = Math.max(best, vor, nach);
  }
  return Math.max(0, best);
}

/**
 * Obergrenze für die Länge des NÄCHSTEN Dienstes an diesem Tag, damit die
 * Stoßzeit nicht überbesetzt wird. Unendlich, solange noch Platz im Fenster
 * ist.
 *
 * Der Grund für diese Prüfung: Verschieben allein rettet nichts mehr. An einem
 * Samstag 13–22 Uhr hat ein 9-h-Dienst genau EINE mögliche Lage. Standen dort
 * erst einmal drei 9-h-Dienste, waren zwangsläufig drei Leute im Abendfenster,
 * obwohl höchstens zwei erlaubt sind – kein Umsortieren konnte das heilen.
 * Also muss die Grenze schon bei der Wahl der LÄNGE greifen: sobald so viele
 * lange Dienste am Tag hängen, wie das Fenster Personen zulässt, darf der
 * nächste nur noch so lang sein, dass er komplett daneben passt.
 */
function peakLengthCapHours(
  blocks: DayBlocks,
  onDay: readonly Shift[],
  peaks: readonly PeakWindow[],
): number {
  let cap = Number.POSITIVE_INFINITY;
  for (const peak of peaks) {
    const dodge = dodgeLimitMinutes(blocks, peak);
    // Dienste, die länger sind als die Ausweichlücke, MÜSSEN ins Fenster
    // ragen – egal, wohin man sie schiebt.
    let unvermeidbar = 0;
    for (const s of onDay) {
      if (s.endMinutes - s.startMinutes > dodge) unvermeidbar++;
    }
    if (unvermeidbar >= peak.maxStaff) cap = Math.min(cap, dodge / 60);
  }
  return cap;
}

/**
 * Würde ein Dienst dieser Länge an diesem Tag die Obergrenze einer Spitze
 * REISSEN, weil er sie zwangsläufig abdeckt?
 *
 * Ein Dienst, der länger ist als die Ausweichlücke neben einer Spitze mit
 * echter Obergrenze (SCHLUSS: 21:30–22:30, max 6), deckt deren Fenster ab, egal
 * wohin man ihn legt. Zu viele davon reißen die Grenze, und kein Umsortieren heilt
 * das mehr. Der Greedy verhindert das schon über peakLengthCapHours – die
 * REPARATURLÄUFE aber schieben ganze Dienste zwischen Tagen und kannten die
 * Regel bisher nicht. Sie sind der Grund, warum vereinzelt doch zwei Dienste
 * bis 22:30 durchliefen. `exclude` blendet den Dienst aus, der den Zieltag im
 * selben Zug verlässt (Tausch).
 */
function wouldExceedClosingCap(
  state: SchedulerState,
  isoDate: string,
  paidMinutes: number,
  exclude?: Shift,
): boolean {
  const day = state.dayOf(isoDate);
  if (day.closed) return false;
  const presence = presenceFromPaid(paidMinutes);
  for (const peak of state.peaksOf(isoDate)) {
    if (peak.maxStaff >= 12) continue; // keine echte Obergrenze
    const dodge = dodgeLimitMinutes(day.blocks, peak);
    if (presence <= dodge) continue; // dieser Dienst kann die Spitze meiden
    let unvermeidbar = 1; // der neu hinzukommende Dienst
    for (const s of state.shifts) {
      if (s.date !== isoDate || s === exclude) continue;
      if (s.endMinutes - s.startMinutes > dodge) unvermeidbar++;
    }
    if (unvermeidbar > peak.maxStaff) return true;
  }
  return false;
}

/**
 * Wählt die Länge (Stunden) der nächsten Schicht eines Mitarbeiters so, dass
 * - sie 3..9 h ist und ins Tagesfenster passt (<= maxHours),
 * - der verbleibende Rest exakt aufteilbar bleibt (0 oder >= 3 h),
 * - Vollzeit möglichst lange, Teilzeit eher kürzere Schichten bekommt.
 * Gibt 0 zurück, wenn an diesem Tag keine gültige Länge möglich ist.
 *
 * Dadurch arbeiten auch Vollzeit-Kräfte an einem „halben Tag" – nur mit einer
 * kürzeren Schicht – und das Monats-Soll bleibt trotzdem exakt.
 */
export function chooseShiftHours(
  remainingMinutes: number,
  maxHours: number,
  employmentType: Employee["employmentType"],
  /** Mindestlänge, um das Soll bis Monatsende noch zu schaffen (Stunden). */
  needHours = MAX_SHIFT_HOURS,
  /** Ohne Zufallsquelle wird deterministisch die kürzeste taugliche gewählt. */
  rng?: () => number,
  /**
   * Länge (Stunden), ab der ein Dienst die Stoßzeit decken kann. > 0 heißt:
   * dieser Tag braucht noch so einen Dienst.
   */
  peakHours = 0,
): number {
  const remainingHours = remainingMinutes / 60;
  // maxHours bringt die Grenze der Person schon mit (9 h, für den Chef 10);
  // ein zweiter Deckel auf MAX_SHIFT_HOURS würde ihn wieder auf 9 stutzen.
  const cap = Math.min(maxHours, remainingHours);
  if (cap < 3) return 0;

  // Erlaubte Längen je Anstellungsart (Vorgabe des Chefs): Vollzeit macht keine
  // Kurzschichten, Teilzeit darf die ganze Bandbreite.
  const pick = (allowed: readonly number[]): number[] => {
    const out: number[] = [];
    for (const hours of allowed) {
      if (hours > cap) continue;
      // Der Rest muss mit denselben Längen restlos aufgehen. Bei Vollzeit
      // (6/7/8) sind z.B. 9, 10, 11 oder 17 Stunden Sackgassen.
      if (canDecompose(remainingHours - hours, allowed)) out.push(hours);
    }
    return out;
  };

  // Früher entschied eine feste Rangliste (Vollzeit 8, Teilzeit 5). Ergebnis:
  // jede Vollzeitschicht war 8 h, jede Teilzeitschicht 5 h – keinerlei
  // Abwechslung, und Teilzeit war faktisch auf 5 h/Tag gedeckelt.
  //
  // Jetzt: unter allen Längen zufällig wählen, aber nur solche, die das Tempo
  // halten. Wer noch viel Soll und wenig Tage hat, bekommt zwangsläufig lange
  // Schichten; wer gut liegt, bekommt Abwechslung.
  const choose = (valid: number[]): number => {
    const onPace = valid.filter((h) => h >= needHours).sort((a, b) => a - b);
    if (onPace.length === 0) return valid[valid.length - 1];

    // Ohne Zufallsquelle läuft der strenge Rückfallversuch (attempt(false)).
    // Dort zählt nur noch, dass das Soll überhaupt aufgeht: die LÄNGSTE Länge
    // braucht die wenigsten Tage und hat deshalb die besten Chancen.
    //
    // Diese Unterscheidung ist der eigentliche Sinn des Rückfalls. Fehlte sie,
    // verhielte sich der strenge Versuch exakt wie die vorherigen fünf – das
    // Sicherheitsnetz wäre keins mehr. Genau daran scheiterte der Plan bei
    // einem Laden, der SIEBEN Tage offen hat: dort erzwingt die Sechs-Tage-
    // Regel Lücken, das Soll geht knapp nicht auf, und ohne den Rückfall gab
    // es gar keinen Plan.
    if (!rng) return onPace[onPace.length - 1];

    // Im Normalfall die KÜRZESTE Länge, die das Tempo noch hält.
    //
    // needHours ist bereits das Mittel, das nötig ist, um das Soll bis
    // Monatsende genau aufzubrauchen. Wer länger arbeitet als dieses Mittel,
    // ist vorzeitig fertig – und steht dem Laden die restlichen Tage nicht
    // mehr zur Verfügung. Bei kleinen Deputaten fällt das brutal auf: 43 h in
    // 9-h-Diensten sind nach fünf Tagen weg, in 5-h-Diensten reichen sie für
    // neun.
    return onPace[0];
  };

  // Braucht der Tag noch einen stoßzeittauglichen Dienst, wird zuerst NUR mit
  // den langen Längen gerechnet – und zwar auch für den Rest. Ohne diese
  // zweite Bedingung bleibt am Monatsende ein Rest übrig, der sich nicht mehr
  // in lange Dienste zerlegen lässt (z.B. 13 h), und genau dort entstehen die
  // kurzen Schichten, die eine Stoßzeit nie decken können.
  if (peakHours > 0) {
    const longOnly = ALLOWED_HOURS[employmentType].filter((h) => h >= peakHours);
    const validLong = pick(longOnly);
    if (validLong.length > 0) return choose(validLong);
  }

  // Braucht der Tag keinen langen Dienst mehr, darf etwa jede zehnte Schicht
  // bewusst kurz ausfallen – nur dann bleibt der Rest auch aufteilbar.
  if (rng && peakHours === 0 && rng() < SHORT_SHIFT_CHANCE) {
    const shortValid = pick(
      ALLOWED_HOURS[employmentType].filter((h) => SHORT_SHIFT_HOURS.includes(h)),
    );
    if (shortValid.length > 0) return shortValid[Math.floor(rng() * shortValid.length)];
  }

  // Erst die für die Anstellungsart vorgesehenen Längen. Geht dort nichts –
  // etwa an einem halben Tag, an dem keine 6-h-Schicht mehr hineinpasst –
  // greift die volle Bandbreite, damit auch Vollzeit an dem Tag arbeiten kann.
  let valid = pick(ALLOWED_HOURS[employmentType]);
  if (valid.length === 0) valid = pick(ALL_HOURS);
  if (valid.length === 0) return 0;

  return choose(valid);
}

/** Stabile Basisordnung: Vollzeit zuerst, dann nach Id. */
function orderedEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => {
    if (a.employmentType !== b.employmentType) {
      return a.employmentType === "VOLLZEIT" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function chooseTemplateType(
  state: SchedulerState,
  isoDate: string,
  employmentType: Employee["employmentType"],
): TemplateType {
  const ds = state.dateState.get(isoDate)!;
  const effKey = state.effKeyOf(isoDate);
  const desired = LATE_SHIFT_RATIOS[effKey];
  const currentLateRatio = ds.totalPaid > 0 ? ds.latePaid / ds.totalPaid : 0;

  // Teilzeit tendenziell in Spätschichten. Früher wurde sonntags zusätzlich
  // auf 0,95 hochgezwungen – damit stand am Sonntag praktisch niemand zur
  // Öffnung um 11:00 im Laden. Jetzt gilt die konfigurierte Quote.
  let threshold = desired;
  if (employmentType !== "VOLLZEIT") threshold += 0.15;

  return currentLateRatio < threshold ? "LATE" : "EARLY";
}

/**
 * In welchen Öffnungsblock gehört ein Dienst dieser Länge?
 *
 * Früh sucht von vorn, Spät von hinten – und beide nehmen den ersten Block,
 * der lang genug ist. Nötig, seit ein Tag MEHRERE Blöcke haben kann: Di–Fr ist
 * von 15:00 bis 17:00 zu. Vorher wurde stumpf der Rahmen des ganzen Tages
 * (11:30–22:00) benutzt, und eine 5-h-Frühschicht landete auf 11:30–16:30 –
 * anderthalb Stunden davon bei geschlossenem Laden. Betroffen war gut ein
 * Viertel aller Dienste.
 *
 * Gibt es keinen passenden Block, kommt der längste zurück; der Aufrufer hat
 * die Länge dann schon vorher auf longestBlock begrenzt.
 */
function blockForShift(blocks: DayBlocks, presence: number, type: TemplateType): DayWindow {
  const passend = blocks.filter((b) => b.endMinutes - b.startMinutes >= presence);
  if (passend.length === 0) {
    return blocks.reduce((a, b) =>
      b.endMinutes - b.startMinutes > a.endMinutes - a.startMinutes ? b : a,
    );
  }
  return type === "LATE" ? passend[passend.length - 1] : passend[0];
}

/**
 * Ein Öffnungsblock, in dem eine Stoßzeit liegt und in dem noch NIEMAND steht.
 *
 * Nötig, weil der Mittagsblock Di–Fr nur 3,5 h lang ist: Dienste ab 4 h passen
 * dort nicht hinein und wandern alle in den Abendblock. Ohne dieses Signal
 * stand der Laden Di–Fr von 11:30 bis 15:00 leer – ausgerechnet in der Zeit,
 * die die Chefin als die volle nennt. Vorher fiel das nicht auf, weil Dienste
 * damals über die Mittagsschließung hinweg geplant wurden.
 */
function uncoveredPeakBlock(state: SchedulerState, isoDate: string): DayWindow | null {
  const day = state.dayOf(isoDate);
  if (day.closed) return null;
  const peaks = state.peaksOf(isoDate);
  if (peaks.length === 0) return null;

  const imBlock = (block: DayWindow) =>
    state.shifts.filter(
      (sh) =>
        sh.date === isoDate &&
        sh.startMinutes >= block.startMinutes &&
        sh.endMinutes <= block.endMinutes,
    );

  for (const block of day.blocks) {
    for (const peak of peaks) {
      if (peak.minStaff <= 0) continue;
      const von = Math.max(peak.startMinutes, block.startMinutes);
      const bis = Math.min(peak.endMinutes, block.endMinutes);
      if (bis <= von) continue;

      // Nicht nur "steht da überhaupt jemand", sondern "ist die Spanne
      // LÜCKENLOS besetzt". Der Mittagsblock ist 3,5 h lang, ein Dienst aber
      // höchstens 3 h (ganze Stunden) – eine einzelne Kraft lässt also immer
      // eine halbe Stunde offen. Erst ein zweiter, versetzter Dienst schließt
      // sie; das Anordnen übernimmt danach arrangeForPeaks.
      if (minCoverageOver(imBlock(block), von, bis) < peak.minStaff) return block;
    }
  }
  return null;
}

function makeShift(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  paidMinutes: number,
  /** Erzwingt einen bestimmten Öffnungsblock (siehe uncoveredPeakBlock). */
  forceBlock?: DayWindow,
): Shift {
  const type = chooseTemplateType(state, isoDate, employee.employmentType);
  const day = state.dayOf(isoDate);
  // Blöcke, in denen diese Person an diesem Tag schon steht, sind tabu.
  //
  // Ohne das legten die Reparaturläufe zwei Dienste in DENSELBEN Block: sie
  // rufen makeShift ohne vorgegebenen Block, und der nahm bis dahin einfach den
  // ersten passenden – also wieder den Mittag, obwohl dort schon ein Dienst
  // derselben Person lag. Heraus kamen zwei Dienste 11:30–14:30 am selben Tag.
  // Fuer den Azubi sind das nur die Abendfenster (siehe blocksFor).
  const erlaubt = blocksFor(day, employee, isoDate);
  const belegt = blocksUsedOn(state, employee.id, isoDate);
  const frei = erlaubt.filter((b) => !belegt.has(day.blocks.findIndex((x) => x.startMinutes === b.startMinutes && x.endMinutes === b.endMinutes)));
  // Ist wirklich nichts frei, bleibt nur der längste Block – dann greift
  // hinterher fixSameEmployeeOverlaps. Vorher wurde hier auf den ERSTEN Block
  // zurückgefallen, und der war meist genau der schon belegte.
  const auswahl =
    frei.length > 0
      ? frei
      : [blockForShift(erlaubt.length > 0 ? erlaubt : day.blocks, presenceFromPaid(paidMinutes), type)];

  const block =
    forceBlock ??
    (employee.isOwner
      ? frameOf(day.blocks) // durchgehend, auch über die Mittagsschließung
      : blockForShift(auswahl, presenceFromPaid(paidMinutes), type));
  const tpl = getShiftTemplate(paidMinutes / 60, type, block.startMinutes, block.endMinutes);
  return {
    id: nextShiftId(),
    employeeId: employee.id,
    date: isoDate,
    startMinutes: tpl.startMinutes,
    endMinutes: tpl.endMinutes,
    pauseMinutes: tpl.pauseMinutes,
    paidMinutes: tpl.paidMinutes,
    shiftType: tpl.type,
    generated: true,
  };
}

function applyShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid += shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid += shift.paidMinutes;
  ds.count += 1;
  state.worked.get(shift.employeeId)!.add(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) + 1,
    );
  }
  state.shifts.push(shift);
}

/**
 * Platziert genau eine Schicht für einen Mitarbeiter: bestes Datum wählen,
 * Schichtlänge an das Tagesfenster anpassen. Gibt true zurück, wenn platziert.
 */
/**
 * Welche Öffnungsblöcke dieses Tages hat die Person schon belegt?
 *
 * Kylan schließt Di–Fr von 15:00 bis 17:00. Wer nur EINEN Block arbeiten darf,
 * kommt an solchen Tagen auf höchstens 5 Stunden – daraus entstand eine Decke
 * von 161 h im Monat, die es in Wirklichkeit nicht gibt: im Laden arbeitet man
 * mittags UND abends. Die Regel "ein Dienst pro Tag" stammt aus einer Filiale
 * ohne Mittagsschließung; dort war sie harmlos, hier war sie schlicht falsch.
 *
 * Erlaubt ist deshalb: höchstens EIN Dienst je Block, also an einem Tag mit
 * zwei Blöcken auch zwei Dienste. Die Tagesobergrenze an Stunden gilt weiter.
 */
function blocksUsedOn(state: SchedulerState, employeeId: string, isoDate: string): Set<number> {
  const day = state.dayOf(isoDate);
  const used = new Set<number>();
  for (const sh of state.shifts) {
    if (sh.employeeId !== employeeId || sh.date !== isoDate) continue;
    const i = day.blocks.findIndex(
      (b) => sh.startMinutes >= b.startMinutes && sh.endMinutes <= b.endMinutes,
    );
    used.add(i >= 0 ? i : -1); // -1: Dienst über den ganzen Rahmen (Chef)
  }
  return used;
}

/** Wie viele Dienste hat diese Person an diesem Tag schon? */
function shiftCountOn(state: SchedulerState, employeeId: string, isoDate: string): number {
  let n = 0;
  for (const sh of state.shifts) if (sh.employeeId === employeeId && sh.date === isoDate) n++;
  return n;
}

/** Schon an diesem Tag verplante bezahlte Stunden dieser Person. */
function dayHoursOf(state: SchedulerState, employeeId: string, isoDate: string): number {
  let min = 0;
  for (const sh of state.shifts) {
    if (sh.employeeId === employeeId && sh.date === isoDate) min += sh.paidMinutes;
  }
  return min / 60;
}

/**
 * Wie viele Stunden darf die Person an diesem Tag NOCH bekommen?
 *
 * 0 heißt: der Tag ist für sie durch – entweder sind alle Blöcke belegt oder
 * die Tagesobergrenze ist erreicht. Der Chef arbeitet über den ganzen Rahmen
 * und bekommt deshalb nur einen Dienst je Tag.
 */
function dayRoomLeft(state: SchedulerState, employee: Employee, isoDate: string): number {
  const day = state.dayOf(isoDate);
  const belegt = blocksUsedOn(state, employee.id, isoDate);
  if (belegt.size === 0) return maxHoursFor(employee);
  // Chef: sein Dienst deckt den ganzen Tag ab, ein zweiter passt nicht daneben.
  if (employee.isOwner || belegt.has(-1)) return 0;
  // Nach ANZAHL der Dienste zählen, nicht nach der Menge belegter Blöcke:
  // liegen zwei Dienste versehentlich im selben Block, meldet die Menge nur
  // einen belegten Block – und es käme ein dritter Dienst dazu.
  if (shiftCountOn(state, employee.id, isoDate) >= day.blocks.length) return 0;
  return Math.max(0, maxHoursFor(employee) - dayHoursOf(state, employee.id, isoDate));
}

/**
 * Passt ein Dienst dieser LÄNGE an diesem Tag noch zu dieser Person?
 *
 * Die eine Frage, durch die jede Zuteilung muss – erste Verteilung, Umzug und
 * Tausch. Vorher wurde an den drei Stellen unterschiedlich geprüft: mal nur die
 * Stundenzahl, mal nur "arbeitet schon an dem Tag". Dabei sind Dienste
 * entstanden, die sich überlappen oder in einen zu kurzen Block gezwängt
 * wurden.
 *
 * Bedingungen: ein freier Block, der lang genug ist, und die Tagesobergrenze
 * an Stunden. Der Chef arbeitet über den ganzen Rahmen und bekommt deshalb nur
 * einen Dienst je Tag.
 */
function fitsOnDay(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  paidMinutes: number,
): boolean {
  const day = state.dayOf(isoDate);
  if (day.closed) return false;

  const belegt = blocksUsedOn(state, employee.id, isoDate);
  const praesenz = presenceFromPaid(paidMinutes);

  if (employee.isOwner) {
    if (belegt.size > 0) return false;
    return spanFor(day, employee, isoDate) >= praesenz;
  }
  if (belegt.has(-1)) return false; // fremder Dienst über den ganzen Rahmen
  if (shiftCountOn(state, employee.id, isoDate) >= day.blocks.length) return false;
  if (dayHoursOf(state, employee.id, isoDate) + paidMinutes / 60 > maxHoursFor(employee)) {
    return false;
  }
  const erlaubt = blocksFor(day, employee, isoDate);
  return erlaubt.some((b) => {
    const i = day.blocks.findIndex((x) => x.startMinutes <= b.startMinutes && x.endMinutes >= b.endMinutes);
    return !belegt.has(i) && b.endMinutes - b.startMinutes >= praesenz;
  });
}

/** Erster freier Öffnungsblock dieser Person an diesem Tag. */
function freeBlockOn(state: SchedulerState, employee: Employee, isoDate: string): DayWindow | null {
  const day = state.dayOf(isoDate);
  const belegt = blocksUsedOn(state, employee.id, isoDate);
  // Nur Bloecke, die dieser Person offenstehen – beim Azubi also unter der
  // Woche allein das Abendfenster.
  for (const b of blocksFor(day, employee, isoDate)) {
    const i = day.blocks.findIndex((x) => x.startMinutes <= b.startMinutes && x.endMinutes >= b.endMinutes);
    if (!belegt.has(i)) return b;
  }
  return null;
}

/**
 * Hat die Person in DIESER Woche noch einen Arbeitstag frei (maxDaysPerWeek)?
 * `statt` blendet einen Tag aus, der im selben Zug abgegeben wird (Umzug/Tausch).
 * Ohne gesetzte Obergrenze immer true.
 */
function weekDayRoomLeft(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  statt?: string,
): boolean {
  const grenze = employee.maxDaysPerWeek;
  if (!grenze) return true;
  const woche = weekStartOf(isoDate);
  let n = 0;
  for (const d of state.worked.get(employee.id) ?? []) {
    if (d === statt) continue;
    if (weekStartOf(d) === woche) n++;
  }
  return n < grenze;
}

/** Schon in DIESER ISO-Woche verplante bezahlte Minuten dieser Person. */
function weekMinutesOf(state: SchedulerState, employeeId: string, weekStart: string): number {
  let min = 0;
  for (const sh of state.shifts) {
    if (sh.employeeId === employeeId && weekStartOf(sh.date) === weekStart) min += sh.paidMinutes;
  }
  return min;
}

/**
 * Wie viele Minuten darf die Person in der Woche von `isoDate` NOCH bekommen?
 *
 * Unendlich ohne Wochenvertrag (dann gibt es keine Wochen-Deckelung, das
 * Monats-Soll verteilt sich frei wie bisher). Mit Wochenvertrag: das Wochen-Soll
 * minus dem schon in dieser Woche Verplanten – so landet jede Woche nahe an den
 * vertraglichen Wochenstunden, statt dass eine Woche 42 h und die nächste 36 h
 * bekommt. Eine Woche ohne eigenes Soll (winzige Rand-Woche, deren Stunden in
 * die Nachbarwoche geschoben wurden) wird NICHT gedeckelt.
 */
function weekRoomLeftMin(state: SchedulerState, employee: Employee, isoDate: string): number {
  if (!state.enforceWeekCap) return Number.POSITIVE_INFINITY;
  const ziel = state.weekTarget.get(employee.id);
  if (!ziel) return Number.POSITIVE_INFINITY;
  const wk = weekStartOf(isoDate);
  const target = ziel.get(wk);
  if (target == null || target <= 0) return Number.POSITIVE_INFINITY;
  return target - weekMinutesOf(state, employee.id, wk);
}

/**
 * Darf ein Dienst dieser Person von `from` nach `to` wandern (Umzug/Tausch),
 * ohne die Wochenverteilung zu kippen?
 *
 * Bei Wochenvertrag (weeklyHours) NUR innerhalb derselben ISO-Woche: die
 * Reparaturläufe optimieren die TAGES-Nachfrage und würden sonst einen Dienst
 * fröhlich in die Nachbarwoche schieben – genau die Wochenbalance, die beim
 * Verteilen bewusst eingehalten wurde, ginge dabei wieder verloren. Ohne
 * Wochenvertrag gibt es keine solche Bindung.
 */
function sameWeekIfWeekly(
  state: SchedulerState,
  employeeId: string,
  from: string,
  to: string,
): boolean {
  if (!state.enforceWeekCap) return true;
  if (!state.weekTarget.has(employeeId)) return true;
  return weekStartOf(from) === weekStartOf(to);
}

/**
 * Gibt das Entfernen dieses Dienstes den Tag der Person wirklich frei?
 *
 * Nur wenn KEIN weiterer Dienst derselben Person am selben Tag hängt. Seit
 * geteilte Dienste erlaubt sind (mittags UND abends), bleibt der Tag sonst
 * belegt. Das ist wichtig für das Wochentage-Limit: der abgegebene Tag darf nur
 * dann als „aufgegeben" (statt) zählen, wenn er dadurch tatsächlich frei wird –
 * sonst schleust ein Umzug/Tausch einen vierten Wochentag durch, obwohl der
 * dritte weiter besetzt bleibt.
 */
function shiftFreesDay(state: SchedulerState, shift: Shift): boolean {
  return !state.shifts.some(
    (x) => x !== shift && x.employeeId === shift.employeeId && x.date === shift.date,
  );
}

function placeOneShift(state: SchedulerState, employee: Employee): boolean {
  const remaining = state.remaining.get(employee.id)!;
  if (remaining <= 0) return false;

  const worked = state.worked.get(employee.id)!;
  const weekendCount = state.weekendCount.get(employee.id) ?? 0;

  // Wie viele Tage kann dieser Mitarbeiter ab jetzt WIRKLICH noch arbeiten?
  //
  // Greedy von vorn durchspielen und dabei die Sechs-Tage-Regel mitführen –
  // dieselbe Rechnung wie in monthCapacity, nur für diese Person und ihren
  // aktuellen Stand. Das Ergebnis ist eine echte Obergrenze, kein Schätzwert.
  //
  // Vorher stand hier `daysLeft * 0.9`, ein pauschaler Sicherheitsabschlag von
  // zehn Prozent. Der reicht, solange der Laden einen festen Ruhetag hat: der
  // geschlossene Tag unterbricht die Kette, und fast jeder offene Tag bleibt
  // belegbar. Hat der Laden gar keinen Ruhetag, sind es aber höchstens sechs
  // von je sieben Tagen, also 85,7 Prozent – die Schätzung war zu optimistisch,
  // das Tempo dadurch zu langsam, und am Monatsende blieben Stunden übrig, für
  // die es keinen zulässigen Tag mehr gab. Der Plan scheiterte dann komplett.
  let usableDays = 0;
  const trial = new Set(worked);
  // Schon verplante Tage je Woche – für die Wochentage-Obergrenze (maxDaysPerWeek).
  const wochenTage = new Map<string, number>();
  if (employee.maxDaysPerWeek) {
    for (const d of worked) wochenTage.set(weekStartOf(d), (wochenTage.get(weekStartOf(d)) ?? 0) + 1);
  }
  for (const isoDate of state.dates) {
    if (trial.has(isoDate)) continue;
    const day = state.dayOf(isoDate);
    if (day.closed) continue;
    // Urlaubstage zaehlen hier NICHT mit. Sonst rechnet das Tempo mit Tagen,
    // die es nicht gibt: die Schichten fallen zu kurz aus, und am Monatsende
    // fehlen Stunden, fuer die kein Tag mehr uebrig ist.
    if (!mayWorkOn(employee, isoDate)) continue;
    if (maxShiftHoursForWindow(spanFor(day, employee, isoDate)) === 0) continue;
    if (consecutiveRunLengthWith(trial, isoDate) > 6) continue;
    // Wochentage-Obergrenze: eine schon volle Woche liefert keine weiteren Tage.
    if (employee.maxDaysPerWeek) {
      const wk = weekStartOf(isoDate);
      if ((wochenTage.get(wk) ?? 0) >= employee.maxDaysPerWeek) continue;
      wochenTage.set(wk, (wochenTage.get(wk) ?? 0) + 1);
    }
    trial.add(isoDate); // belegt – zählt für die Kette der folgenden Tage mit
    usableDays += 1;
  }

  const needHours =
    usableDays > 0 ? Math.ceil(remaining / 60 / usableDays) : MAX_SHIFT_HOURS;

  let bestDate: string | null = null;
  let bestHours = 0;
  let bestBlock: DayWindow | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed) continue; // Betriebsruhe -> kein Dienst
    if (!mayWorkOn(employee, isoDate)) continue; // eingetragener Urlaub / freier Wochentag
    if (!weekDayRoomLeft(state, employee, isoDate)) continue; // Wochentage aufgebraucht
    // Höchstens ein Dienst je BLOCK statt je Tag – siehe dayRoomLeft.
    const tagesRest = dayRoomLeft(state, employee, isoDate);
    if (tagesRest < 3) continue;

    // Wochen-Soll (weeklyHours): in dieser ISO-Woche darf nur noch so viel
    // dazukommen, wie das Wochen-Soll hergibt. Ist die Woche praktisch voll
    // (Rest unter einer Mindestschicht), diesen Tag auslassen und in einer
    // anderen Woche suchen – so bleibt jede Woche nahe an den Wochenstunden,
    // statt dass eine Woche 42 h und die nächste 36 h bekommt. Ohne
    // Wochenvertrag ist weekRest unendlich (keine Deckelung).
    const weekRest = weekRoomLeftMin(state, employee, isoDate);
    if (weekRest < MIN_SHIFT_MINUTES) continue;

    // ── Sonderregeln für den Chef ──────────────────────────────────────────
    // Er arbeitet mit, aber nach eigenem Rhythmus: fünf Tage die Woche, und
    // samstags ist er nicht im Laden. Beides sind harte Regeln wie die
    // Sechs-Tage-Regel – ein Tag, der sie bricht, wird gar nicht erst geprüft.
    if (employee.isOwner) {
      if (weekdayKeyOf(parseIsoDate(isoDate)) === OWNER_FREE_WEEKDAY) continue;
      let inWeek = 0;
      const weekStart = weekStartOf(isoDate);
      for (const d of worked) if (weekStartOf(d) === weekStart) inWeek++;
      if (inWeek >= OWNER_DAYS_PER_WEEK) continue;
    }


    const dsNow = state.dateState.get(isoDate)!;
    const wanted = coverSize(state, isoDate); // wie viele Leute der Tag braucht
    const bodiesMissing = Math.max(0, wanted - dsNow.count);

    // Längste Schicht, die ins Fenster passt UND den Rest exakt aufteilbar lässt.
    const schonBelegt = blocksUsedOn(state, employee.id, isoDate).size > 0;
    const freierBlock = freeBlockOn(state, employee, isoDate);

    let maxHours = Math.min(
      maxShiftHoursForWindow(spanFor(day, employee, isoDate)),
      maxHoursFor(employee),
      tagesRest, // ein zweiter Dienst darf die Tagesgrenze nicht reißen
      Math.floor(weekRest / 60), // Wochen-Soll nicht überschreiten
    );
    // Ein zweiter Dienst muss in einen noch freien Block passen.
    if (schonBelegt) {
      if (!freierBlock) continue;
      maxHours = Math.min(
        maxHours,
        maxShiftHoursForWindow(freierBlock.endMinutes - freierBlock.startMinutes),
      );
      if (maxHours < 3) continue;
    }

    // Reichen die Stunden des Tages nicht für die volle Abdeckung, ist ZWEI
    // Personen wichtiger als eine lange. Vorher entstanden reihenweise Tage
    // mit einer einzigen 9-h-Schicht von 10 bis 20 Uhr: die Person steht den
    // ganzen Tag allein im Laden, und während ihrer Pause ist niemand da.
    // Deshalb die Länge so deckeln, dass für die fehlenden Personen noch
    // Stunden des Tages übrig bleiben.
    if (bodiesMissing > 1) {
      const leftHours = (state.rawTarget.get(isoDate)! - dsNow.totalPaid) / 60;
      const share = Math.floor(leftHours / bodiesMissing);
      // Der Deckel darf das EIGENE Tempo nie unterschreiten. Sonst macht er
      // den Monat unplanbar: braucht ein Tag drei Dienste (bei 11:30-22:00 und
      // einer Abendspitze schafft keine einzelne Schicht beides, Öffnen und
      // 21 Uhr), dann ist ein Drittel der Tagesstunden schnell weniger, als die
      // Kraft im Schnitt pro Tag braucht - und ihr Soll geht nie auf.
      const limit = Math.max(share, needHours);
      if (limit >= 3) maxHours = Math.min(maxHours, limit);
    }

    // Solange der Tag noch nicht genug LANGE Dienste hat, um die Stoßzeit zu
    // decken, wird die Mindestlänge hochgezogen. Ohne das entstehen Tage mit
    // rechnerisch genug Stunden, aber falscher Aufteilung (16 h als 7 + 9),
    // und die Stoßzeit bleibt unbesetzt – verschieben hilft dann nicht mehr.
    //
    // ABER nur, wenn der Tag sich die Abdeckung überhaupt leisten kann. Sonst
    // erzwingt die Regel eine Form, die nie aufgeht, und richtet Schaden an:
    // die billigste Abdeckung ist 9 h + 6 h, also verlangte JEDER leere Tag
    // zuerst einen 9-h-Dienst. Bei 26 Tagen sind das 234 h allein dafür – bei
    // 317 h Gesamtsoll bleibt für die zweite Person kaum etwas übrig, und eine
    // Teilzeitkraft mit 55 h ist nach sechs Diensten durch.
    // Steht in einem Öffnungsblock noch niemand, hat dieser Dienst dort mehr
    // Wert als irgendwo sonst – auch wenn er dafür kürzer ausfallen muss.
    // Di–Fr betrifft das den Mittagsblock: er ist 3,5 h lang, also passt nur
    // ein 3-h-Dienst hinein, während alle längeren in den Abend wandern.
    const leererBlock = uncoveredPeakBlock(state, isoDate);
    const blockStunden = leererBlock
      ? Math.floor((leererBlock.endMinutes - leererBlock.startMinutes) / 60)
      : 0;
    // Wie überall gilt: der Deckel darf das eigene Tempo nicht unterlaufen.
    // Eine Kraft mit 150 h im Monat braucht rund 6 h am Tag; schickt man sie
    // in den 3-h-Mittagsblock, verbrennt sie einen ihrer wenigen möglichen
    // Tage und das Monats-Soll geht am Ende nicht auf. Den Mittag füllt, wer
    // es sich leisten kann – die Kräfte mit kleinem Soll.
    // Ein leerer Block hilft nur, wenn die Person dort überhaupt arbeiten darf.
    // Sonst wurde der Azubi in den Mittagsblock geschickt, den er gar nicht
    // bedienen darf.
    const blockErlaubt =
      leererBlock !== null &&
      blocksFor(day, employee, isoDate).some(
        (b) => b.startMinutes <= leererBlock.startMinutes && b.endMinutes >= leererBlock.endMinutes,
      );

    const fuellDenBlock =
      // Für den Chef nicht: sein Dienst läuft ohnehin über den ganzen Rahmen und
      // deckt damit beide Blöcke ab. Ihn auf einen Block zu stutzen nähme ihm
      // genau die Länge, für die es die Sonderregel gibt.
      !employee.isOwner &&
      blockErlaubt &&
      leererBlock !== null &&
      blockStunden >= 3 &&
      blockStunden < maxHours &&
      blockStunden >= needHours;
    if (fuellDenBlock) maxHours = blockStunden;

    // Deckel aus der Stoßzeit-Obergrenze (siehe peakLengthCapHours).
    const peakCap = peakLengthCapHours(
      day.blocks,
      state.shifts.filter((s) => s.date === isoDate),
      state.peaksOf(isoDate),
    );

    const coverHours = cheapestPeakCover(day.blocks, state.peaksOf(isoDate)).reduce((sum, h) => sum + h, 0);
    const dayTargetHours = state.rawTarget.get(isoDate)! / 60;
    const affordsCover = coverHours > 0 && dayTargetHours >= coverHours - 0.5;
    const stillNeedsLong = affordsCover
      ? Math.min(missingCoverHours(state, isoDate), maxHours)
      : 0;

    // Für die Längenwahl zählt der kleinere der beiden Reste: bei Wochenvertrag
    // das Wochen-Soll (weekRest), sonst das Monats-Soll (remaining). So bleibt
    // auch der WOCHEN-Rest restlos in Schichten zerlegbar und die Woche geht
    // exakt auf – nicht nur der Monat.
    const restFuerLaenge = Math.min(remaining, weekRest);
    const laenge = (cap: number) =>
      cap < 3
        ? 0
        : chooseShiftHours(
            restFuerLaenge,
            cap,
            employee.employmentType,
            stillNeedsLong > 0 ? Math.max(needHours, stillNeedsLong) : needHours,
            state.varyLengths ? state.rng : undefined,
            stillNeedsLong,
          );

    // Erst die Länge suchen, die unter der Stoßzeit-Obergrenze bleibt.
    let hours = laenge(Math.min(maxHours, Math.floor(peakCap)));
    // Frühere Fassung ließ hier das eigene Tempo den Deckel überstimmen: war die
    // gedeckelte Länge kürzer als das Tagesmittel (needHours), wurde sie
    // verworfen und stattdessen doch die lange Schicht gelegt. Das ist der
    // Grund, warum früher zu viele Dienste bis 22:30 durchliefen: der Abendblock
    // (16:30–22:30) ist genau 6 h, ein 6-h-Dienst deckt zwangsläufig die letzte
    // Stunde ab. Der Deckel hat Vorrang; die Schließbesetzung bleibt bei höchstens sechs.
    let peakPenalty = 0;
    if (hours === 0) {
      // Unter dem Deckel geht gar keine gültige Länge auf. Der Deckel ist dann
      // bewusst KEIN K.o.: sonst bleibt am Monatsende ein Rest Sollstunden
      // liegen und es entsteht gar kein Plan. Ein Tag mit einer Person zu viel
      // ist besser als kein Plan – er wird in der Auswertung als Abweichung
      // ausgewiesen. Die Strafe sorgt dafür, dass das die allerletzte Wahl bleibt.
      hours = laenge(maxHours);
      if (Number.isFinite(peakCap)) peakPenalty = 60;
    }
    if (hours === 0) continue; // hier passt keine gültige Schicht

    // Harte Regel. Früher gab es hier einen Ausweichtag, der diese Prüfung
    // übersprungen hat – dabei entstanden lautlos Pläne mit bis zu 28
    // Arbeitstagen am Stück. Lieber gar keinen Plan als einen unzulässigen:
    // ohne gültigen Tag bleibt das Soll offen und generateSchedule wirft.
    const runLength = consecutiveRunLengthWith(worked, isoDate);
    if (runLength > 6) continue;

    const ds = state.dateState.get(isoDate)!;
    const deficitHours = (state.rawTarget.get(isoDate)! - ds.totalPaid) / 60;
    const dayWeight = DAY_WEIGHTS[state.effKeyOf(isoDate)];

    // Ein Tag ohne zweite Person wiegt schwerer als ein Tag, dem nur noch
    // Stunden fehlen. Ohne diesen Bonus jagt der Scheduler nur der Stundenzahl
    // hinterher und lässt halbe Monate mit Ein-Personen-Tagen zurück.
    const staffingBonus = bodiesMissing * 15;

    // Der Tag braucht noch einen langen Dienst, dieser hier ist aber zu kurz:
    // dann soll er lieber woanders hin und der Tag auf jemanden warten, der
    // die Länge liefern kann. Ohne das füllt der erste beste Kurzdienst die
    // Stunden des Tages auf und die Stoßzeit ist nicht mehr zu retten.
    const shapePenalty = stillNeedsLong > 0 && hours < stillNeedsLong ? 12 : 0;

    const consecutivePenalty = runLength >= 5 ? (runLength - 4) * 8 : 0;
    const weekendPenalty = isWeekend(isoDate) ? weekendCount * 1.5 : 0;

    const jitter = state.rng() * 0.01; // deterministisch (seeded), nur Tie-Break

    // Kräftig genug, um den Tag gegen einen anderen mit mehr offenen Stunden
    // zu gewinnen: ein leerer Block heißt offener Laden ohne Personal.
    const blockBonus = fuellDenBlock ? 25 : 0;

    const score =
      deficitHours * 10 +
      staffingBonus +
      blockBonus +
      dayWeight * 3 -
      shapePenalty -
      peakPenalty -
      consecutivePenalty -
      weekendPenalty +
      jitter;

    if (score > bestScore) {
      bestScore = score;
      bestDate = isoDate;
      bestHours = hours;
      bestBlock = fuellDenBlock
        ? leererBlock!
        : schonBelegt
          ? (freierBlock ?? undefined)
          : undefined;
    }
  }

  if (bestDate === null || bestHours === 0) return false;

  const shift = makeShift(state, employee, bestDate, bestHours * 60, bestBlock);
  applyShift(state, shift);
  state.remaining.set(employee.id, remaining - shift.paidMinutes);
  return true;
}

/**
 * Darf sich die Abdeckung eines Tages so verändern?
 *
 * Erlaubt ist alles, was die geforderte Abdeckung weiter trägt – und bei
 * Tagen, die sie ohnehin nicht erreichen, alles, was nichts verschlimmert.
 * Ohne diese Schranke räumt der Reparaturlauf die Stoßzeit wieder ab: er
 * optimiert nur die Tagesstunden und schiebt fröhlich einen zu kurzen Dienst
 * auf einen Tag, der die Länge braucht.
 */
function peakCapacityOk(required: number, oldCount: number, newCount: number): boolean {
  return newCount >= Math.min(required, oldCount);
}

/** Kosten eines Tages = |zugewiesene - rohe Soll-Minuten|. */
function dateCost(state: SchedulerState, isoDate: string): number {
  return Math.abs(
    state.dateState.get(isoDate)!.totalPaid - state.rawTarget.get(isoDate)!,
  );
}

/**
 * Darf diese Person an diesem Tag arbeiten? Für alle außer dem Chef: ja.
 *
 * Der Chef arbeitet fünf Tage die Woche und samstags nicht. placeOneShift
 * beachtet das seit jeher – die REPARATURLÄUFE aber nicht: sie verschieben und
 * tauschen Termine und haben den Chef dabei prompt auf Samstage und in
 * Sechs-Tage-Wochen gesetzt. Deshalb steht die Regel jetzt an einer Stelle,
 * durch die jeder dieser Wege muss.
 *
 * `statt` ist der Tag, den die Person im selben Zug abgibt – er zählt bei der
 * Wochenrechnung nicht mehr mit.
 */
function ownerDayOk(state: SchedulerState, employeeId: string, isoDate: string, statt?: string): boolean {
  // Urlaub gilt fuer JEDEN, nicht nur fuer den Chef. Er steht hier, weil dies
  // das eine Tor ist, durch das jedes Verschieben und jeder Tausch muss – in
  // einer anderen Filiale stand eine solche Regel nur beim ersten Verteilen,
  // und die Reparaturlaeufe danach haben sie klaglos wieder aufgehoben.
  const wer = state.byId.get(employeeId);
  if (wer && !mayWorkOn(wer, isoDate)) return false;
  // Wochentage-Obergrenze gilt fuer JEDEN – auch dieses Tor muss sie halten,
  // sonst setzt ein Reparaturlauf jemanden auf einen vierten Tag der Woche.
  if (wer && !weekDayRoomLeft(state, wer, isoDate, statt)) return false;

  if (!state.owners.has(employeeId)) return true;
  if (weekdayKeyOf(parseIsoDate(isoDate)) === OWNER_FREE_WEEKDAY) return false;

  const woche = weekStartOf(isoDate);
  let inWoche = 0;
  for (const d of state.worked.get(employeeId)!) {
    if (d === statt) continue;
    if (weekStartOf(d) === woche) inWoche++;
  }
  return inWoche < OWNER_DAYS_PER_WEEK;
}

/**
 * Die Arbeitstage einer Person, wenn EIN bestimmter Dienst wegfällt.
 *
 * Der Tag fällt nur dann heraus, wenn kein weiterer Dienst derselben Person an
 * ihm hängt. Seit geteilte Dienste erlaubt sind, kann das vorkommen – und wer
 * den Tag trotzdem austrägt, rechnet die Sechs-Tage-Regel zu günstig und
 * genehmigt Ketten von sieben oder acht Tagen.
 */
function workedWithout(state: SchedulerState, shift: Shift): Set<string> {
  const tage = new Set(state.worked.get(shift.employeeId)!);
  const nochWelche = state.shifts.some(
    (x) => x !== shift && x.employeeId === shift.employeeId && x.date === shift.date,
  );
  if (!nochWelche) tage.delete(shift.date);
  return tage;
}

function removeShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid -= shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  ds.count -= 1;
  // Der Tag zählt nur dann nicht mehr als Arbeitstag, wenn KEIN weiterer
  // Dienst dieser Person an ihm hängt. Seit geteilte Dienste erlaubt sind, kann
  // das vorkommen – und wer den Tag trotzdem austrägt, verliert ihn für die
  // Sechs-Tage-Regel. Genau so entstanden acht Arbeitstage am Stück.
  const nochWelche = state.shifts.some(
    (x) => x !== shift && x.employeeId === shift.employeeId && x.date === shift.date,
  );
  if (!nochWelche) state.worked.get(shift.employeeId)!.delete(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) - 1,
    );
  }
  const idx = state.shifts.indexOf(shift);
  // Ohne diese Prüfung würde splice(-1, 1) die LETZTE Schicht löschen und das
  // Monats-Soll lautlos reißen.
  if (idx < 0) {
    throw new Error("removeShift: Schicht ist nicht (mehr) im Plan");
  }
  state.shifts.splice(idx, 1);
}

/**
 * Reparaturlauf: verschiebt einzelne Schichten auf andere Tage, wenn dadurch
 * die Tagesnachfrage besser getroffen wird. Ändert nie die Dauer eines Tokens
 * und verletzt nie die harten Regeln => Sollstunden bleiben exakt erhalten.
 */
function repairDemand(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 6;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    // Kopie, da wir state.shifts während der Iteration verändern.
    for (const shift of [...state.shifts]) {
      const employee = employeesById.get(shift.employeeId)!;
      const from = shift.date;

      let bestTarget: string | null = null;
      let bestDelta = -1e-6; // nur echte Verbesserungen

      const oldCostFrom = dateCost(state, from);

      const presence = presenceFromPaid(shift.paidMinutes);
      for (const to of state.dates) {
        if (to === from) continue;
        if (!mayWorkOn(employee, to)) continue; // fester freier Wochentag / Urlaub
        // `from` zählt nur dann als abgegeben, wenn dieser Umzug den Quelltag
        // wirklich frei macht (bei geteilten Diensten sonst nicht).
        const gibtFrom = shiftFreesDay(state, shift) ? from : undefined;
        if (!weekDayRoomLeft(state, employee, to, gibtFrom)) continue; // Wochentage aufgebraucht
        // Der Zieltag muss noch Platz haben – ein freier Block und genug
        // Stunden bis zur Tagesgrenze.
        if (!fitsOnDay(state, employee, to, shift.paidMinutes)) continue;
        if (!ownerDayOk(state, employee.id, to, gibtFrom)) continue;
        // Bei Wochenvertrag nicht über die Wochengrenze schieben (Wochenbalance).
        if (!sameWeekIfWeekly(state, employee.id, from, to)) continue;
        // Die Obergrenze des Schließteams auf dem Zieltag nicht überschreiten.
        if (wouldExceedClosingCap(state, to, shift.paidMinutes)) continue;
        const day = state.dayOf(to);
        if (day.closed || spanFor(day, employee, to) < presence) continue; // zu / passt nicht
        // 6-Tage-Regel prüfen, als ob dieser Dienst schon weg wäre.
        const trial = workedWithout(state, shift);
        if (consecutiveRunLengthWith(trial, to) > 6) continue;

        // Die Stoßzeit darf durch einen Umzug nicht schlechter besetzbar werden.
        const hoursFrom = dayPaidHours(state, from);
        const hoursTo = dayPaidHours(state, to);
        const moved = shift.paidMinutes / 60;
        const withoutMoved = hoursFrom.filter((_, i) => i !== hoursFrom.indexOf(moved));
        if (
          !peakCapacityOk(
            coverSize(state, from),
            coverFilledFor(state, from, hoursFrom),
            coverFilledFor(state, from, withoutMoved),
          )
        ) {
          continue;
        }
        if (
          !peakCapacityOk(
            coverSize(state, to),
            coverFilledFor(state, to, hoursTo),
            coverFilledFor(state, to, [...hoursTo, moved]),
          )
        ) {
          continue;
        }

        const oldCostTo = dateCost(state, to);
        const newCostFrom = Math.abs(
          state.dateState.get(from)!.totalPaid - shift.paidMinutes - state.rawTarget.get(from)!,
        );
        const newCostTo = Math.abs(
          state.dateState.get(to)!.totalPaid + shift.paidMinutes - state.rawTarget.get(to)!,
        );
        const delta = newCostFrom + newCostTo - (oldCostFrom + oldCostTo);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestTarget = to;
        }
      }

      if (bestTarget) {
        removeShift(state, shift);
        applyShift(state, makeShift(state, employee, bestTarget, shift.paidMinutes));
        improved = true;
      }
    }
    if (trySwaps(state, employeesById)) improved = true;
    if (!improved) break;
  }
}

/**
 * Tauscht zwei Schichten zwischen zwei Tagen (verschiedene Mitarbeiter).
 *
 * Warum zusätzlich zum Umzug: ein Umzug verschiebt immer den GANZEN Block –
 * bei Schichten von 3..9 h springt das Tages-Soll dadurch grob. Ein Tausch
 * verschiebt nur die Differenz der beiden Längen (z.B. 9 h gegen 7 h = 2 h)
 * und trifft die Tagesnachfrage deutlich feiner.
 *
 * Wie der Umzug ändert der Tausch keine Dauer und verletzt keine harte Regel
 * => jedes Monats-Soll bleibt exakt erhalten.
 */
/**
 * Dürfen diese zwei Dienste die Tage tauschen, ohne eine harte Regel zu brechen?
 *
 * `allowSameEmployee` erlaubt den Sonderfall, dass BEIDE Dienste derselben
 * Person gehören. Dann tauschen faktisch nur die Längen zwischen zwei ihrer
 * Arbeitstage: die Arbeitstage selbst bleiben dieselben, also können weder die
 * Ein-Dienst-pro-Tag-Regel noch die Sechs-Tage-Regel verletzt werden. Für die
 * Stoßzeiten-Reparatur ist das der wichtigste Zug überhaupt – ein Tag, dem ein
 * langer Dienst fehlt, findet unter fremden Diensten oft keinen Spender, wohl
 * aber unter den eigenen Tagen desselben Mitarbeiters.
 */
function canSwap(state: SchedulerState, a: Shift, b: Shift, allowSameEmployee = false): boolean {
  if (a.date === b.date) return false;

  const sameEmployee = a.employeeId === b.employeeId;
  if (sameEmployee && !allowSameEmployee) return false; // sonst wäre es ein Umzug

  // Bei Wochenvertrag keinen Dienst über die Wochengrenze tauschen – das würde
  // die bewusst eingehaltene Wochenverteilung wieder auflösen.
  if (!sameWeekIfWeekly(state, a.employeeId, a.date, b.date)) return false;
  if (!sameWeekIfWeekly(state, b.employeeId, b.date, a.date)) return false;

  if (!sameEmployee) {
    // Höchstens ein Dienst pro Mitarbeiter und Tag.
    if (!fitsOnDay(state, state.byId.get(a.employeeId)!, b.date, a.paidMinutes)) return false;
    if (!fitsOnDay(state, state.byId.get(b.employeeId)!, a.date, b.paidMinutes)) return false;

    // Fester freier Wochentag / Wochentage-Obergrenze am jeweiligen Zieltag.
    const empA = state.byId.get(a.employeeId)!;
    const empB = state.byId.get(b.employeeId)!;
    if (!mayWorkOn(empA, b.date) || !mayWorkOn(empB, a.date)) return false;
    // Ein abgegebener Tag zählt nur, wenn der Tausch ihn wirklich frei macht.
    const gibtA = shiftFreesDay(state, a) ? a.date : undefined;
    const gibtB = shiftFreesDay(state, b) ? b.date : undefined;
    if (!weekDayRoomLeft(state, empA, b.date, gibtA)) return false;
    if (!weekDayRoomLeft(state, empB, a.date, gibtB)) return false;

    // 6-Tage-Regel für beide, jeweils ohne den eigenen alten Dienst.
    const trialA = workedWithout(state, a);
    if (consecutiveRunLengthWith(trialA, b.date) > 6) return false;
    const trialB = workedWithout(state, b);
    if (consecutiveRunLengthWith(trialB, a.date) > 6) return false;
  }

  // Für den Chef gelten eigene Regeln – auch beim Tausch. Der abgegebene Tag
  // zählt auch hier nur, wenn er durch den Tausch wirklich frei wird.
  if (!ownerDayOk(state, a.employeeId, b.date, shiftFreesDay(state, a) ? a.date : undefined)) return false;
  if (!ownerDayOk(state, b.employeeId, a.date, shiftFreesDay(state, b) ? b.date : undefined)) return false;

  // Die getauschten Längen müssen in das jeweilige Fenster passen.
  // Die Spanne richtet sich nach der Person, die den Dienst übernimmt.
  if (spanFor(state.dayOf(a.date), state.byId.get(b.employeeId), a.date) < presenceFromPaid(b.paidMinutes)) {
    return false;
  }
  if (spanFor(state.dayOf(b.date), state.byId.get(a.employeeId), b.date) < presenceFromPaid(a.paidMinutes)) {
    return false;
  }

  return true;
}

/** Führt den Tausch aus: a wandert auf b.date, b auf a.date. Dauer bleibt. */
function performSwap(
  state: SchedulerState,
  a: Shift,
  b: Shift,
  employeesById: Map<string, Employee>,
): void {
  const empA = employeesById.get(a.employeeId)!;
  const empB = employeesById.get(b.employeeId)!;
  const dateA = a.date;
  const dateB = b.date;
  const paidA = a.paidMinutes;
  const paidB = b.paidMinutes;
  removeShift(state, a);
  removeShift(state, b);
  applyShift(state, makeShift(state, empA, dateB, paidA));
  applyShift(state, makeShift(state, empB, dateA, paidB));
}

/**
 * Zweiter Reparaturlauf, diesmal ausschließlich für die Stoßzeit.
 *
 * repairDemand optimiert nur die Tagesstunden. Ein Tag kann damit rechnerisch
 * genau richtig liegen und die Stoßzeit trotzdem nicht besetzen – etwa 16 h
 * als 7 h + 9 h statt 8 h + 8 h. Von selbst repariert sich das nie, weil jeder
 * Tausch, der die Form verbessert, die Stundenbilanz leicht verschlechtert und
 * deshalb dort abgelehnt wird.
 *
 * Hier gilt die umgekehrte Priorität: ein Tag ohne genug lange Dienste tauscht
 * einen kurzen gegen einen langen von einem Tag, der ihn entbehren kann. Die
 * Stundenverschiebung wird bewusst in Kauf genommen – die Stoßzeiten-Regel ist
 * eine Vorgabe des Betriebs, die Tagesgewichtung nur ein Richtwert.
 */
function repairPeakCapacity(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    for (const isoDate of state.dates) {
      const needHours = missingCoverHours(state, isoDate);
      if (needHours === 0) continue; // Tag ist versorgt

      // Kürzeste zuerst hergeben: die reißt die geringste Lücke.
      const tooShort = state.shifts
        .filter((s) => s.date === isoDate && s.paidMinutes < needHours * 60)
        .sort((x, y) => x.paidMinutes - y.paidMinutes);

      let swapped = false;
      for (const short of tooShort) {
        for (const long of [...state.shifts]) {
          if (long.date === isoDate) continue;
          if (long.paidMinutes < needHours * 60) continue; // taugt hier nicht

          // Der abgebende Tag darf dadurch nicht selbst unterversorgt werden.
          const donorHours = dayPaidHours(state, long.date);
          const afterDonor = donorHours
            .filter((_, i) => i !== donorHours.indexOf(long.paidMinutes / 60))
            .concat(short.paidMinutes / 60);
          if (
            !peakCapacityOk(
              coverSize(state, long.date),
              coverFilledFor(state, long.date, donorHours),
              coverFilledFor(state, long.date, afterDonor),
            )
          ) {
            continue;
          }

          // Auch Tausche innerhalb derselben Person sind hier erlaubt.
          if (!canSwap(state, short, long, true)) continue;

          performSwap(state, short, long, employeesById);
          improved = true;
          swapped = true;
          break;
        }
        if (swapped) break;
      }
    }

    if (!improved) break;
  }
}

function trySwaps(state: SchedulerState, employeesById: Map<string, Employee>): boolean {
  let improved = false;
  const snapshot = [...state.shifts];

  for (let i = 0; i < snapshot.length; i++) {
    const a = snapshot[i];
    if (!state.shifts.includes(a)) continue; // schon getauscht
    for (let j = i + 1; j < snapshot.length; j++) {
      const b = snapshot[j];
      if (!state.shifts.includes(b)) continue;
      if (a.date === b.date) continue; // gleicher Tag => keine Wirkung
      if (a.paidMinutes === b.paidMinutes) continue; // gleiche Länge => keine Wirkung
      if (a.employeeId === b.employeeId) continue; // das wäre ein Umzug

      const empA = employeesById.get(a.employeeId)!;
      const empB = employeesById.get(b.employeeId)!;
      // Harte Regel: höchstens ein Dienst pro Mitarbeiter und Tag.
      if (!fitsOnDay(state, empA, b.date, a.paidMinutes)) continue;
      if (!fitsOnDay(state, empB, a.date, b.paidMinutes)) continue;

      // Bei Wochenvertrag nicht über die Wochengrenze tauschen (Wochenbalance).
      if (!sameWeekIfWeekly(state, a.employeeId, a.date, b.date)) continue;
      if (!sameWeekIfWeekly(state, b.employeeId, b.date, a.date)) continue;

      // Kein Tausch, der auf einem der beiden Tage die Schließobergrenze
      // überschreitet. a landet auf b.date, b auf a.date – der jeweils
      // wegziehende Dienst wird dabei ausgeblendet.
      if (wouldExceedClosingCap(state, b.date, a.paidMinutes, b)) continue;
      if (wouldExceedClosingCap(state, a.date, b.paidMinutes, a)) continue;

      // Fester freier Wochentag / Wochentage-Obergrenze am jeweiligen Zieltag.
      // Der abgegebene Tag zählt nur, wenn der Tausch ihn wirklich frei macht.
      if (!mayWorkOn(empA, b.date) || !mayWorkOn(empB, a.date)) continue;
      const gibtA = shiftFreesDay(state, a) ? a.date : undefined;
      const gibtB = shiftFreesDay(state, b) ? b.date : undefined;
      if (!weekDayRoomLeft(state, empA, b.date, gibtA)) continue;
      if (!weekDayRoomLeft(state, empB, a.date, gibtB)) continue;

      // Und die Sonderregeln des Chefs (kein Samstag, fünf Tage die Woche).
      // Diese Funktion prüft alles selbst, statt canSwap zu rufen – die
      // Owner-Regel darf hier deshalb nicht fehlen.
      if (!ownerDayOk(state, empA.id, b.date, gibtA)) continue;
      if (!ownerDayOk(state, empB.id, a.date, gibtB)) continue;

      // Die getauschten Längen müssen in das jeweilige Fenster passen.
      const dayA = state.dayOf(a.date);
      const dayB = state.dayOf(b.date);
      if (windowLength(dayA) < presenceFromPaid(b.paidMinutes)) continue;
      if (windowLength(dayB) < presenceFromPaid(a.paidMinutes)) continue;

      // 6-Tage-Regel für beide prüfen, jeweils ohne den eigenen alten Dienst.
      const trialA = workedWithout(state, a);
      if (consecutiveRunLengthWith(trialA, b.date) > 6) continue;
      const trialB = workedWithout(state, b);
      if (consecutiveRunLengthWith(trialB, a.date) > 6) continue;

      // Auch der Tausch darf die Stoßzeit nicht abräumen: a landet auf b.date
      // und umgekehrt, die Längen wandern also mit.
      const hoursA = dayPaidHours(state, a.date);
      const hoursB = dayPaidHours(state, b.date);
      const pa = a.paidMinutes / 60;
      const pb = b.paidMinutes / 60;
      const nextA = hoursA.filter((_, i) => i !== hoursA.indexOf(pa)).concat(pb);
      const nextB = hoursB.filter((_, i) => i !== hoursB.indexOf(pb)).concat(pa);
      if (
        !peakCapacityOk(
          coverSize(state, a.date),
          coverFilledFor(state, a.date, hoursA),
          coverFilledFor(state, a.date, nextA),
        )
      ) {
        continue;
      }
      if (
        !peakCapacityOk(
          coverSize(state, b.date),
          coverFilledFor(state, b.date, hoursB),
          coverFilledFor(state, b.date, nextB),
        )
      ) {
        continue;
      }

      const dsA = state.dateState.get(a.date)!;
      const dsB = state.dateState.get(b.date)!;
      const targetA = state.rawTarget.get(a.date)!;
      const targetB = state.rawTarget.get(b.date)!;
      const oldCost =
        Math.abs(dsA.totalPaid - targetA) + Math.abs(dsB.totalPaid - targetB);
      const newCost =
        Math.abs(dsA.totalPaid - a.paidMinutes + b.paidMinutes - targetA) +
        Math.abs(dsB.totalPaid - b.paidMinutes + a.paidMinutes - targetB);
      if (newCost >= oldCost - 1e-6) continue; // nur echte Verbesserungen

      const dateA = a.date;
      const dateB = b.date;
      const paidA = a.paidMinutes;
      const paidB = b.paidMinutes;
      removeShift(state, a);
      removeShift(state, b);
      applyShift(state, makeShift(state, empA, dateB, paidA));
      applyShift(state, makeShift(state, empB, dateA, paidB));
      improved = true;
      break; // a existiert nicht mehr – mit dem nächsten a weitermachen
    }
  }

  return improved;
}

/** Dreht NUR Früh/Spät um. Dauer bleibt gleich => Monats-Soll bleibt exakt. */
function retypeShift(state: SchedulerState, shift: Shift, type: TemplateType): void {
  if (shift.shiftType === type) return;
  const day = state.dayOf(shift.date);
  const praesenz = presenceFromPaid(shift.paidMinutes);

  // Für den Chef gilt der ganze Rahmen, nicht ein einzelner Block – wie in
  // makeShift. Fehlte das hier, landete seine 8-Stunden-Schicht am Anfang des
  // Abendblocks und endete um 25:30, also weit nach Ladenschluss: der Block ist
  // nur fünf Stunden lang, die Schicht mit Pause aber achteinhalb.
  const wer = state.byId.get(shift.employeeId);
  const chef = wer?.isOwner === true;
  // Beim Umdrehen gelten dieselben Fenster wie beim Anlegen. Ohne das wurde aus
  // der Abendschicht des Azubi wieder eine Frühschicht am Blockanfang – Mi ab
  // 17:00, also eine Stunde zu früh.
  const offen = blocksFor(day, wer, shift.date);
  if (offen.length === 0) return;
  const block = chef ? frameOf(day.blocks) : blockForShift(offen, praesenz, type);

  // Passt die Schicht nirgends hin, bleibt sie lieber liegen, als aus dem
  // Fenster zu ragen.
  if (block.endMinutes - block.startMinutes < praesenz) return;
  const tpl = getShiftTemplate(
    shift.paidMinutes / 60,
    type,
    block.startMinutes,
    block.endMinutes,
  );
  const ds = state.dateState.get(shift.date)!;

  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  shift.startMinutes = tpl.startMinutes;
  shift.endMinutes = tpl.endMinutes;
  shift.pauseMinutes = tpl.pauseMinutes;
  shift.shiftType = tpl.type;
  if (tpl.type === "LATE") ds.latePaid += shift.paidMinutes;
}

/**
 * Wie viele Personen zu viel stünden in der Stoßzeit, wenn dieser Tag GENAU
 * diese Schichtlängen hätte – plus die Lücken, die er dann nicht mehr decken
 * könnte.
 *
 * Gezählt wird nach LÄNGE, nicht nach Uhrzeit: ein Dienst, der länger ist als
 * die Lücke neben dem Fenster, ragt zwangsläufig hinein, egal wohin man ihn
 * schiebt. Genau deshalb hilft Umsortieren an solchen Tagen nicht mehr.
 *
 * Die Funktion rechnet nur, sie ändert nichts. Das ist Absicht: so lässt sich
 * ein Tausch bewerten, BEVOR er ausgeführt wird. Der frühere Ansatz – tauschen,
 * messen, notfalls zurücktauschen – ist daran gescheitert, dass performSwap die
 * alten Schicht-Objekte durch neue ersetzt; das Zurücktauschen griff dann ins
 * Leere.
 */
function dayPeakScore(state: SchedulerState, isoDate: string, paidHours: number[]): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;

  let score = 0;
  for (const peak of state.peaksOf(isoDate)) {
    const dodge = dodgeLimitMinutes(day.blocks, peak);
    const drin = paidHours.filter((h) => presenceFromPaid(h * 60) > dodge).length;
    score += Math.max(0, drin - peak.maxStaff);
  }

  const fehlt = coverSize(state, isoDate) - coverFilledFor(state, isoDate, paidHours);
  return score + Math.max(0, Number.isFinite(fehlt) ? fehlt : 0);
}

/** Liste ohne EIN Vorkommen von wert (nicht ohne alle). */
function ohneEins(werte: number[], wert: number): number[] {
  const out = [...werte];
  const i = out.indexOf(wert);
  if (i >= 0) out.splice(i, 1);
  return out;
}

/**
 * Dritter Reparaturlauf: Tage, an denen zu VIELE Leute in der Stoßzeit stehen.
 *
 * repairPeakCapacity kümmert sich um das Gegenteil (zu wenige). Beides über
 * einen Kamm zu scheren ginge nicht: dort wird ein kurzer Dienst gegen einen
 * langen getauscht, hier genau andersherum.
 *
 * Getauscht werden nur DATEN, die Dauer bleibt bei der Person – das Monats-Soll
 * bleibt also unangetastet. Ein Tausch wird nur ausgeführt, wenn er die Summe
 * beider betroffener Tage verbessert; einen Tag zu heilen und dafür den anderen
 * zu zerlegen bringt nichts.
 */
function repairPeakExcess(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    for (const isoDate of state.dates) {
      const day = state.dayOf(isoDate);
      if (day.closed) continue;
      if (dayPeakScore(state, isoDate, dayPaidHours(state, isoDate)) === 0) continue;

      // Kleinste Ausweichlücke des Tages: darunter passt ein Dienst neben jede
      // Stoßzeit dieses Tages.
      let dodge = Number.POSITIVE_INFINITY;
      for (const peak of state.peaksOf(isoDate)) {
        dodge = Math.min(dodge, dodgeLimitMinutes(day.blocks, peak));
      }
      if (!Number.isFinite(dodge)) continue;

      // Die kürzesten der zu langen Dienste zuerst hergeben: für die findet
      // sich am ehesten ein Tauschpartner.
      const zuLang = state.shifts
        .filter((s) => s.date === isoDate && s.endMinutes - s.startMinutes > dodge)
        .sort((x, y) => x.paidMinutes - y.paidMinutes);

      for (const lang of zuLang) {
        const hierJetzt = dayPaidHours(state, isoDate);
        if (dayPeakScore(state, isoDate, hierJetzt) === 0) break;
        if (!state.shifts.includes(lang)) continue; // schon weggetauscht

        const kurz = state.shifts
          .filter((s) => s.date !== isoDate && presenceFromPaid(s.paidMinutes) <= dodge)
          .sort((x, y) => y.paidMinutes - x.paidMinutes); // größter Rest zuerst

        for (const partner of kurz) {
          if (!canSwap(state, lang, partner, true)) continue;

          const dortJetzt = dayPaidHours(state, partner.date);
          const langH = lang.paidMinutes / 60;
          const kurzH = partner.paidMinutes / 60;

          const vorher =
            dayPeakScore(state, isoDate, hierJetzt) +
            dayPeakScore(state, partner.date, dortJetzt);
          const nachher =
            dayPeakScore(state, isoDate, [...ohneEins(hierJetzt, langH), kurzH]) +
            dayPeakScore(state, partner.date, [...ohneEins(dortJetzt, kurzH), langH]);

          if (nachher >= vorher) continue;

          performSwap(state, lang, partner, employeesById);
          improved = true;
          break;
        }
      }
    }

    if (!improved) break;
  }
}

/**
 * Nachlauf über die Schichttypen. Zwei Ziele, in dieser Reihenfolge:
 *  1. Die Spätquote je Tag näher an den Sollwert bringen (vorher schwankte
 *     sie stark, obwohl für alle ruhigen Tage derselbe Wert gilt).
 *  2. Wichtiger als jede Quote: an jedem offenen Tag muss jemand aufsperren
 *     UND jemand zusperren. Vorher kam es vor, dass um 11:00 niemand da war.
 * Es wird ausschließlich der Typ gedreht, nie die Dauer – das Soll bleibt exakt.
 */
/**
 * Letzte Kontrolle: kein Mensch steht zweimal gleichzeitig im Laden.
 *
 * Seit ein Mensch mittags UND abends arbeiten darf, kann eine Person mehrere
 * Dienste an einem Tag haben. Erzeugt werden sie sauber getrennt – aber danach
 * schieben mehrere Läufe die Dienste noch herum (Stoßzeit-Layout, Früh/Spät-
 * Quote), und jeder davon kennt nur seine eigene Frage. In der Summe sind
 * zweimal 11:30–14:30 am selben Tag entstanden.
 *
 * Statt jedem dieser Läufe einzeln beizubringen, worauf er achten muss, steht
 * hier am Ende eine Kontrolle, die den Zustand geradezieht: überlappt ein
 * Dienst einen anderen derselben Person, wandert er in einen freien Block.
 * Das ist die Stelle, die die Zusicherung wirklich hält.
 */
function fixSameEmployeeOverlaps(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed || day.blocks.length < 2) continue;

    const proPerson = new Map<string, Shift[]>();
    for (const sh of state.shifts) {
      if (sh.date !== isoDate) continue;
      const liste = proPerson.get(sh.employeeId);
      if (liste) liste.push(sh);
      else proPerson.set(sh.employeeId, [sh]);
    }

    for (const liste of proPerson.values()) {
      if (liste.length < 2) continue;

      // Welcher Block gehört zu welchem Dienst? -1 = passt in keinen.
      const blockVon = (sh: Shift) =>
        day.blocks.findIndex(
          (b) => sh.startMinutes >= b.startMinutes && sh.endMinutes <= b.endMinutes,
        );

      for (let runde = 0; runde < liste.length; runde++) {
        liste.sort((a, b) => a.startMinutes - b.startMinutes);
        const paar = liste.findIndex(
          (sh, i) => i > 0 && liste[i - 1].endMinutes > sh.startMinutes,
        );
        if (paar < 0) break; // nichts überlappt mehr

        // Beide Beteiligten versuchen: mal passt nur der kürzere in den
        // freien Block. Nur den späteren zu verschieben reicht nicht.
        const kandidaten = [liste[paar], liste[paar - 1]];
        let verschoben = false;

        for (const dieser of kandidaten) {
          const belegt = new Set(liste.filter((x) => x !== dieser).map(blockVon));
          const praesenz = dieser.endMinutes - dieser.startMinutes;
          const ziel = day.blocks.find(
            (b, idx) =>
              !belegt.has(idx) &&
              b.endMinutes - b.startMinutes >= praesenz &&
              zeitErlaubt(dieser, b.startMinutes),
          );
          if (ziel) {
            moveShiftTo(dieser, ziel.startMinutes);
            verschoben = true;
            break;
          }
        }
        // Kein freier Block am selben Tag lang genug (z. B. der Mittagsblock
        // ist zu kurz für einen 5-h-Abenddienst). Dann den überzähligen Dienst
        // auf einen ANDEREN Tag verschieben, an dem die Person gar nicht
        // arbeitet – das erhält ihre Stundenzahl und löst die Überschneidung.
        if (!verschoben) {
          const dieser = liste[paar];
          const emp = state.byId.get(dieser.employeeId);
          if (emp) {
            const worked = state.worked.get(emp.id)!;
            const ziel = state.dates.find(
              (d) =>
                d !== isoDate &&
                !worked.has(d) &&
                mayWorkOn(emp, d) &&
                weekDayRoomLeft(state, emp, d, isoDate) &&
                sameWeekIfWeekly(state, emp.id, isoDate, d) &&
                consecutiveRunLengthWith(worked, d) <= 6 &&
                fitsOnDay(state, emp, d, dieser.paidMinutes),
            );
            if (ziel) {
              const paid = dieser.paidMinutes;
              removeShift(state, dieser);
              applyShift(state, makeShift(state, emp, ziel, paid));
            }
          }
          break;
        }
      }
    }
  }
}

/**
 * Geteilte Dienste eng zusammenrücken.
 *
 * Wer mittags und abends arbeitet, soll dazwischen die Schließzeit frei haben –
 * nicht mehr. Ohne diese Regel entstand: 11:30–14:30 und dann erst 19:00–22:00.
 * Das sind sechs bezahlte Stunden, für die jemand von halb zwölf bis zehn im
 * Dienst ist, mit viereinhalb Stunden Leerlauf und zwei Wegen. Bezahlt wird die
 * Wartezeit nicht, verbraucht ist der Tag trotzdem.
 *
 * Der zweite Dienst wandert deshalb so früh wie möglich in seinen Block –
 * aber nur, wenn die Stoßzeit dadurch nicht schlechter besetzt wird. Die
 * Besetzung geht vor; unnötige Wartezeit ist das kleinere Übel.
 */
/**
 * Kurze Abenddienste auf die Stoßzeit (18–21 Uhr) ziehen.
 *
 * Ohne diese Regel hängt JEDER Abenddienst am Schließen 22:00 (getShiftTemplate
 * verankert "Spät" am Fensterende): ein 3-h-Dienst wird 19:00–22:00. Auf dem
 * ausgehängten Plan steht dann „19–22", obwohl der Andrang zwischen 18 und 21
 * Uhr liegt – die erste Stunde der Spitze bleibt dünn, die stille Stunde nach
 * 21 Uhr doppelt besetzt.
 *
 * Ziel: ein 3-h-Dienst endet um 21:00 (also 18:00–21:00), ein 4-h-Dienst
 * ebenfalls (17:00–21:00). Dauer und Pause bleiben unangetastet, das Monats-Soll
 * also exakt. Zwei Rollen bleiben ausgenommen:
 *
 *  • Das Schließteam. Dienste bleiben bis zum Tagesende, solange die Vorgabe
 *    von fünf bis sechs Personen ab 21:30 sie benötigt.
 *  • Der Abend-Aufsperrer Di–Fr. Der Laden macht mittags zu und um 17:00 wieder
 *    auf; ein Dienst, der am Anfang des Abendblocks (17:00) beginnt, sperrt auf
 *    und bleibt deshalb stehen. Am Wochenende ist 17:00 kein Blockanfang – dort
 *    wird auch ein 17:00-Dienst auf die Spitze gezogen.
 *
 * Verschoben wird nur, wenn der Dienst dabei in seinem Block bleibt, keinen
 * zweiten Dienst derselben Person überlappt, der Tag weiter auf- UND zusperrt
 * und die Spitze nicht ÜBER die erlaubte Personenzahl steigt (peakDeficit darf
 * nicht wachsen).
 */
function concentrateEveningShifts(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed || day.blocks.length === 0) continue;

    // Abendblock = der letzte Block des Tages. Nur sinnvoll, wenn er über das
    // Ende der Spitze hinaus bis zum Schließen reicht (sonst gibt es nichts zu
    // konzentrieren).
    const block = day.blocks[day.blocks.length - 1];
    if (block.endMinutes <= EVENING_RUSH_END) continue;

    const first = day.blocks[0];
    const onDay = state.shifts.filter((s) => s.date === isoDate);
    const peaks = state.peaksOf(isoDate);

    // Nach einem Zug muss der Tag weiter auf- (erster Block) UND zusperren
    // (letzter Block). Sonst steht niemand mehr am Schließen 22:00.
    const opensAndCloses = () =>
      onDay.some((s) => s.startMinutes === first.startMinutes) &&
      onDay.some((s) => s.endMinutes === block.endMinutes);

    // Zieht `s` so vor, dass er spätestens um `tail` endet – falls das erlaubt
    // und sinnvoll ist. Dauer und Pause bleiben, nur die Lage wandert.
    const taperTo = (s: Shift, tail: number) => {
      if (s.endMinutes <= tail) return; // endet ohnehin schon früh genug
      const start = tail - (s.endMinutes - s.startMinutes);
      if (start < block.startMinutes || start >= s.startMinutes) return; // passt nicht / nicht früher
      // Der Azubi darf unter der Woche erst ab 18:00 – ein früherer Start wäre
      // für ihn verboten.
      const wer = state.byId.get(s.employeeId);
      const erlaubt = wer ? blocksFor(day, wer, isoDate) : day.blocks;
      if (!erlaubt.some((b) => start >= b.startMinutes && start + (s.endMinutes - s.startMinutes) <= b.endMinutes)) return;
      if (!freiFuer(onDay, s, start)) return;
      const vorher = s.startMinutes;
      const gut = peakDeficit(onDay, day.window, peaks);
      moveShiftTo(s, start);
      if (!opensAndCloses() || peakDeficit(onDay, day.window, peaks) > gut) moveShiftTo(s, vorher);
    };

    // Einen Schließdienst als Anker behalten. Weitere Dienste werden nur dann
    // vorgezogen, wenn peakDeficit die Besetzung von fünf bis sechs Personen
    // im Schließfenster weiterhin als erfüllt bewertet.
    const eveningShifts = onDay.filter(
      (s) => s.startMinutes >= block.startMinutes && s.endMinutes <= block.endMinutes,
    );
    if (eveningShifts.length === 0) continue;

    const dauer = (s: Shift) => s.endMinutes - s.startMinutes;

    // Mindestens ein Schließdienst muss bis zum Tagesende bleiben. Steht schon
    // jemand am Schließen, ist es der längste dieser Dienste. Steht niemand dort – die
    // vorherigen Läufe (balanceShiftTypes, tightenSplitShifts) können den
    // Schließer versehentlich nach vorn gezogen haben –, wird der längste
    // Abenddienst, der ans Schließen passt, dorthin gesetzt. Sonst schließt
    // niemand den Laden ab.
    let keepCloser = eveningShifts
      .filter((s) => s.endMinutes === block.endMinutes)
      .sort((a, b) => dauer(b) - dauer(a))[0];
    if (!keepCloser) {
      const kandidat = [...eveningShifts]
        .sort((a, b) => dauer(b) - dauer(a))
        .find(
          (s) =>
            block.endMinutes - dauer(s) >= block.startMinutes &&
            freiFuer(onDay, s, block.endMinutes - dauer(s)),
        );
      if (kandidat) {
        moveShiftTo(kandidat, block.endMinutes - dauer(kandidat));
        keepCloser = kandidat;
      }
    }

    for (const s of eveningShifts) {
      if (s === keepCloser) continue;
      if (s.startMinutes === block.startMinutes) continue; // Abend-Aufsperrer bleibt
      taperTo(s, EVENING_TAPER_END);
    }
  }
}

/**
 * Beim ÖFFNEN mindestens die geforderte Personenzahl (AUFSPERREN, min 2).
 *
 * Der Greedy legt genügend Vormittagsdienste an, positioniert den zweiten aber
 * oft auf 11:30 (ein kurzer Mittagsdienst hängt nicht zwingend am Blockanfang).
 * Dann steht 10:30–11:30 nur EINE Kraft im Laden, obwohl der Betrieb zwei zum
 * Aufsperren will. Hier wird ein weiterer Dienst des ERSTEN Blocks auf den
 * Blockanfang gezogen, bis die Öffnungsspitze besetzt ist. Dauer und Pause
 * bleiben unangetastet – das Monats-Soll also exakt.
 *
 * Verschoben wird nur innerhalb des ersten Blocks; die Abend- und Schlussspitze
 * bleiben dadurch unberührt. Ein Zug wird verworfen, wenn er eine andere Spitze
 * über ihre Obergrenze bringt (peakDeficit darf nicht wachsen).
 */
function ensureOpeningStaff(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed || day.blocks.length === 0) continue;
    const peaks = state.peaksOf(isoDate);
    const first = day.blocks[0];
    // Die Öffnungsspitze beginnt am Ladenanfang und fordert mehr als eine Kraft.
    const opening = peaks.find((p) => p.startMinutes <= first.startMinutes && p.minStaff >= 2);
    if (!opening) continue;

    const from = Math.max(opening.startMinutes, first.startMinutes);
    const to = Math.min(opening.endMinutes, first.endMinutes);
    if (to <= from) continue;

    const onDay = state.shifts.filter((s) => s.date === isoDate);
    let guard = 0;
    while (minCoverageOver(onDay, from, to) < opening.minStaff && guard++ < onDay.length) {
      // Ein Dienst des ersten Blocks, der noch nicht am Blockanfang beginnt.
      // Kürzeste zuerst: die reißt am Blockende die kleinste neue Lücke.
      const cand = onDay
        .filter(
          (s) =>
            s.startMinutes > first.startMinutes &&
            s.endMinutes <= first.endMinutes &&
            first.startMinutes + (s.endMinutes - s.startMinutes) <= first.endMinutes,
        )
        .sort((a, b) => a.paidMinutes - b.paidMinutes)[0];
      if (!cand) break;
      if (!freiFuer(onDay, cand, first.startMinutes)) break;
      const before = cand.startMinutes;
      const gut = peakDeficit(onDay, day.window, peaks);
      moveShiftTo(cand, first.startMinutes);
      // Nur behalten, wenn keine andere Spitze dadurch schlechter wird.
      if (peakDeficit(onDay, day.window, peaks) > gut) {
        moveShiftTo(cand, before);
        break;
      }
    }
  }
}

function tightenSplitShifts(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed || day.blocks.length < 2) continue;

    const onDay = state.shifts.filter((sh) => sh.date === isoDate);
    if (onDay.length === 0) continue;
    const peaks = state.peaksOf(isoDate);

    const proPerson = new Map<string, Shift[]>();
    for (const sh of onDay) {
      const liste = proPerson.get(sh.employeeId);
      if (liste) liste.push(sh);
      else proPerson.set(sh.employeeId, [sh]);
    }

    for (const liste of proPerson.values()) {
      if (liste.length < 2) continue;
      liste.sort((a, b) => a.startMinutes - b.startMinutes);

      for (let i = 1; i < liste.length; i++) {
        const spaeter = liste[i];
        const frueher = liste[i - 1];
        const block = day.blocks.find(
          (b) => spaeter.startMinutes >= b.startMinutes && spaeter.endMinutes <= b.endMinutes,
        );
        if (!block) continue;

        const dauer = spaeter.endMinutes - spaeter.startMinutes;
        // Frühestens am Blockanfang, und nie vor dem Ende des ersten Dienstes.
        const frueheste = Math.max(block.startMinutes, frueher.endMinutes);
        if (frueheste >= spaeter.startMinutes) continue; // sitzt schon vorn

        const vorher = spaeter.startMinutes;
        const gut = peakDeficit(onDay, frameOf(day.blocks), peaks);
        for (let start = frueheste; start < vorher; start += 30) {
          if (start + dauer > block.endMinutes) break;
          if (!zeitErlaubt(spaeter, start)) continue;
          moveShiftTo(spaeter, start);
          if (peakDeficit(onDay, frameOf(day.blocks), peaks) <= gut) break; // passt
          moveShiftTo(spaeter, vorher); // Besetzung leidet – zurück
        }
      }
    }
  }
}

function balanceShiftTypes(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed) continue;

    const onDay = state.shifts.filter((s) => s.date === isoDate);
    if (onDay.length === 0) continue;

    const ds = state.dateState.get(isoDate)!;
    const desired = LATE_SHIFT_RATIOS[state.effKeyOf(isoDate)];

    // 1. Quote annähern: jeweils die Schicht drehen, die am meisten hilft.
    for (let step = 0; step < onDay.length * 2; step++) {
      if (ds.totalPaid === 0) break;
      let best: Shift | null = null;
      let bestDiff = Math.abs(ds.latePaid / ds.totalPaid - desired);
      for (const s of onDay) {
        const late =
          s.shiftType === "LATE" ? ds.latePaid - s.paidMinutes : ds.latePaid + s.paidMinutes;
        const diff = Math.abs(late / ds.totalPaid - desired);
        if (diff < bestDiff - 1e-9) {
          bestDiff = diff;
          best = s;
        }
      }
      if (!best) break;
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 2. Öffnen/Schließen sichern. Mit nur einer Schicht am Tag geht beides
    //    nicht – dann bleibt es bei der Quote-Entscheidung.
    if (onDay.length < 2) continue;

    const shortestOf = (list: Shift[]) =>
      list.length === 0 ? null : list.reduce((a, b) => (a.paidMinutes <= b.paidMinutes ? a : b));

    let flipped: Shift | null = null;
    if (!onDay.some((s) => s.startMinutes === day.window.startMinutes)) {
      const victim = shortestOf(onDay.filter((s) => s.shiftType === "LATE"));
      if (victim) {
        retypeShift(state, victim, "EARLY");
        flipped = victim;
      }
    }
    if (!onDay.some((s) => s.endMinutes === day.window.endMinutes)) {
      const victim = shortestOf(
        onDay.filter((s) => s.shiftType === "EARLY" && s !== flipped),
      );
      if (victim) retypeShift(state, victim, "LATE");
    }

    // 3. Stoßzeiten absichern (12–13 und 17–19 Uhr, je mindestens 2 Personen).
    //    Vorher deckte dieser Schritt nur einen Messpunkt zur Mittagszeit ab;
    //    der Abend war ungeprüft. Jetzt wird über beide Spannen die KLEINSTE
    //    Besetzung geprüft, nicht ein einzelner Zeitpunkt.
    //
    //    Zur Mechanik: Frühschichten hängen am Öffnen, Spätschichten am
    //    Schließen. Damit deckt jede Frühschicht den Mittag und jede
    //    Spätschicht den Abend; beide Spitzen zugleich schafft nur eine lange
    //    Schicht (8/9 h). Gedreht wird ausschließlich der Typ, nie die Dauer –
    //    das Monats-Soll bleibt exakt. Reicht die Tagesmasse nicht aus, bleibt
    //    eine Lücke bestehen; sie ist in analyzeSchedule sichtbar.
    const hasOpener = () => onDay.some((s) => s.startMinutes === day.window.startMinutes);
    const hasCloser = () => onDay.some((s) => s.endMinutes === day.window.endMinutes);

    for (let guard = 0; guard < onDay.length * 3; guard++) {
      const deficit = peakDeficit(onDay, day.window, state.peaksOf(isoDate));
      if (deficit === 0) break;

      let best: Shift | null = null;
      let bestDeficit = deficit;
      for (const s of onDay) {
        // shiftType kennt zusätzlich "CUSTOM"; erzeugte Schichten sind immer
        // EARLY oder LATE. Für die Probe wird alles andere wie EARLY behandelt.
        const back: TemplateType = s.shiftType === "LATE" ? "LATE" : "EARLY";
        const target: TemplateType = back === "LATE" ? "EARLY" : "LATE";
        retypeShift(state, s, target);
        // Öffnen/Schließen darf die Spitzenreparatur nicht kaputt machen.
        const ok = hasOpener() && hasCloser();
        const next = ok ? peakDeficit(onDay, day.window, state.peaksOf(isoDate)) : Number.POSITIVE_INFINITY;
        retypeShift(state, s, back);
        if (next < bestDeficit) {
          bestDeficit = next;
          best = s;
        }
      }

      if (!best) break; // keine Drehung verbessert noch etwas
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 4. Reicht Drehen nicht, die Dienste im Fenster neu ANORDNEN.
    layoutDayForPeaks(day.blocks, onDay, state.peaksOf(isoDate));
  }
}

/** Verschiebt einen Dienst auf eine neue Startzeit; Dauer bleibt gleich. */
/**
 * Darf dieser Dienst an dieser Stelle liegen, ohne einen ANDEREN Dienst
 * DERSELBEN Person am selben Tag zu überlappen?
 *
 * Seit ein Mensch mittags und abends arbeiten darf, kann eine Person mehrere
 * Dienste an einem Tag haben. Das Umsortieren für die Stoßzeit kennt diesen
 * Zusammenhang nicht – es schiebt Dienste frei im Fenster herum und hat dabei
 * zwei Dienste derselben Person übereinandergelegt (zweimal 11:30–14:30 am
 * selben Tag). Diese Prüfung verhindert das an jeder Stelle, die verschiebt.
 */
/**
 * Wer im laufenden Monat Azubi ist.
 *
 * Die Umräum-Pässe (arrangeForPeaks, concentrateEveningShifts, …) fassen
 * Dienste an, ohne die Person zu kennen – sie sehen nur Zeiten. Ohne dieses
 * Verzeichnis rutschte der Azubi dort wieder in den Mittag zurück, obwohl er
 * beim Anlegen sauber im Abendfenster saß.
 */
let azubiIds: ReadonlySet<string> = new Set();

/**
 * Darf dieser Dienst zu dieser Zeit stehen?
 *
 * Für alle außer dem Azubi immer ja. Der Azubi darf Mo–Fr nur 18:00–22:00; am
 * Wochenende gilt die normale Öffnungszeit.
 */
function zeitErlaubt(shift: Shift, startMinutes: number): boolean {
  if (!azubiIds.has(shift.employeeId)) return true;
  const tag = weekdayKeyOf(parseIsoDate(shift.date));
  if (tag === "saturday" || tag === "sunday") return true;
  const ende = startMinutes + (shift.endMinutes - shift.startMinutes);
  return startMinutes >= AZUBI_EVENING_START && ende <= AZUBI_EVENING_END;
}

function freiFuer(onDay: Shift[], shift: Shift, startMinutes: number): boolean {
  if (!zeitErlaubt(shift, startMinutes)) return false;
  const ende = startMinutes + (shift.endMinutes - shift.startMinutes);
  return !onDay.some(
    (a) =>
      a !== shift &&
      a.employeeId === shift.employeeId &&
      a.startMinutes < ende &&
      startMinutes < a.endMinutes,
  );
}

function moveShiftTo(shift: Shift, startMinutes: number): void {
  const presence = shift.endMinutes - shift.startMinutes;
  shift.startMinutes = startMinutes;
  shift.endMinutes = startMinutes + presence;
}

/**
 * Startzeiten, an denen ein Dienst überhaupt etwas Nützliches beiträgt:
 * aufsperren, zusperren, oder eine Stoßzeit vollständig abdecken.
 *
 * Der Dienst muss dabei KOMPLETT in einen Block passen. Über eine
 * Mittagsschließung hinweg gibt es keine Schicht – deshalb wird jeder Block
 * einzeln durchgerechnet.
 */
function candidateStarts(
  shift: Shift,
  blocks: DayBlocks,
  peaks: readonly PeakWindow[],
): number[] {
  const presence = shift.endMinutes - shift.startMinutes;
  const out = new Set<number>();

  for (const block of blocks) {
    const latest = block.endMinutes - presence;
    if (latest < block.startMinutes) continue; // passt nicht in diesen Block

    out.add(block.startMinutes); // am Blockanfang
    out.add(latest); // am Blockende

    for (const peak of peaks) {
      const from = Math.max(peak.startMinutes, block.startMinutes);
      const to = Math.min(peak.endMinutes, block.endMinutes);
      if (to <= from || presence < to - from) continue;
      const lo = Math.max(block.startMinutes, to - presence);
      const hi = Math.min(from, latest);
      if (lo <= hi) {
        out.add(lo);
        out.add(hi);
      }
    }
  }

  return [...out].sort((a, b) => a - b);
}

/**
 * Ordnet die Dienste eines Tages so an, dass beide Stoßzeiten besetzt sind
 * und trotzdem jemand auf- und zusperrt. Dauer und Pause bleiben unangetastet
 * => das Monats-Soll bleibt exakt erhalten.
 *
 * Warum nicht einfach Dienst für Dienst verschieben: das bleibt in einem
 * lokalen Optimum stecken. Beispiel 27.07. – eine 8-h-Frühschicht (10:00 bis
 * 18:30) und zwei 5-h-Spätschichten. Mittags steht nur einer im Laden. Wer
 * die Frühschicht verschieben will, nimmt dem Tag den Aufsperrer, also wird
 * der Zug verworfen; erst wenn VORHER eine Spätschicht auf 10:00 rückt, geht
 * es auf. Ein einzelner Zug kommt dort nie hin.
 *
 * Deshalb: Auf- und Zusperrer werden zuerst festgelegt (alle Paare werden
 * durchprobiert), der Rest wird danach frei eingeplant.
 */
function layoutDayForPeaks(blocks: DayBlocks, onDay: Shift[], peaks: readonly PeakWindow[]): void {
  if (onDay.length < 2) return;
  if (peakDeficit(onDay, frameOf(blocks), peaks) === 0) return; // schon gut
  arrangeForPeaks(blocks, onDay, peaks);
}

/**
 * Der eigentliche Suchlauf – ohne die Abkürzung oben. Wird auch von der
 * Kapazitätsrechnung benutzt, die wissen muss, ob eine Kombination von
 * Schichtlängen überhaupt aufgehen KANN.
 */
function arrangeForPeaks(blocks: DayBlocks, onDay: Shift[], peaks: readonly PeakWindow[]): void {
  if (onDay.length < 2) return;

  const frame = frameOf(blocks);
  const first = blocks[0];
  const last = blocks[blocks.length - 1];

  const starts = onDay.map((s) => s.startMinutes);
  const restore = (list: number[]) => onDay.forEach((s, i) => moveShiftTo(s, list[i]));
  // Aufsperren = Anfang des ERSTEN Blocks, Zusperren = Ende des LETZTEN.
  const opensAndCloses = () =>
    onDay.some((s) => s.startMinutes === first.startMinutes) &&
    onDay.some((s) => s.endMinutes === last.endMinutes);

  let bestStarts = [...starts];
  // Eine Ausgangslage ohne Auf- oder Zusperrer zählt nicht als Lösung.
  let bestDeficit = opensAndCloses() ? peakDeficit(onDay, frame, peaks) : Number.POSITIVE_INFINITY;

  for (let i = 0; i < onDay.length && bestDeficit > 0; i++) {
    // i === j ist ausdrücklich erlaubt: ein Dienst, der das ganze Fenster
    // füllt (bei 10–20 Uhr eine 9-h-Schicht), sperrt auf UND zu. Schließt man
    // diesen Fall aus, findet die Suche nie die billigste Lösung – zwei
    // getrennte Anker kosten hier 8 + 8 h, ein Dienst über alles plus ein
    // frei stehender nur 9 + 6 h.
    for (let j = 0; j < onDay.length && bestDeficit > 0; j++) {
      restore(starts);

      // i sperrt auf, j sperrt zu.
      const closerStart = last.endMinutes - (onDay[j].endMinutes - onDay[j].startMinutes);
      if (closerStart < last.startMinutes) continue; // müsste über die Schließung hinweg
      // Dasselbe am anderen Ende: wer aufsperrt, muss in den ersten Block
      // passen. Di–Fr ist der nur 3,5 h lang, ein längerer Dienst ragte sonst
      // in die Mittagsschließung.
      if (onDay[i].endMinutes - onDay[i].startMinutes > first.endMinutes - first.startMinutes) {
        continue;
      }
      if (!freiFuer(onDay, onDay[i], first.startMinutes)) continue;
      moveShiftTo(onDay[i], first.startMinutes);
      if (!freiFuer(onDay, onDay[j], closerStart)) {
        restore(starts);
        continue;
      }
      moveShiftTo(onDay[j], closerStart);

      // Alle übrigen Dienste greedy dorthin, wo sie am meisten helfen.
      for (let k = 0; k < onDay.length; k++) {
        if (k === i || k === j) continue;
        let pick = onDay[k].startMinutes;
        let pickDeficit = Number.POSITIVE_INFINITY;
        for (const c of candidateStarts(onDay[k], blocks, peaks)) {
          if (!freiFuer(onDay, onDay[k], c)) continue;
          moveShiftTo(onDay[k], c);
          const d = peakDeficit(onDay, frame, peaks);
          if (d < pickDeficit) {
            pickDeficit = d;
            pick = c;
          }
        }
        moveShiftTo(onDay[k], pick);
      }

      const deficit = peakDeficit(onDay, frame, peaks);
      if (deficit < bestDeficit) {
        bestDeficit = deficit;
        bestStarts = onDay.map((s) => s.startMinutes);
      }
    }
  }

  restore(bestStarts);
}

/**
 * Obergrenze für EINEN Mitarbeiter: wie viele Tage und Stunden im Monat
 * überhaupt möglich sind. Greedy von vorn – an jedem offenen Tag arbeiten,
 * solange die 6-Tage-Regel es zulässt; danach zwingend ein freier Tag.
 * Das ist das Maximum, mehr geht rein rechnerisch nicht.
 */
function monthCapacity(
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
  capHours = MAX_SHIFT_HOURS,
): { openDays: number; maxDays: number; maxMinutes: number } {
  let openDays = 0;
  let maxDays = 0;
  let maxMinutes = 0;
  let run = 0;

  for (const isoDate of dates) {
    const day = dayOf(isoDate);
    if (day.closed) {
      run = 0; // geschlossener Tag zählt als Pause
      continue;
    }
    openDays += 1;
    const hours = Math.min(maxShiftHoursForWindow(windowLength(day)), capHours);
    if (hours < 3) continue; // Fenster zu kurz für die kürzeste Schicht (3 h)

    if (run >= 6) {
      run = 0; // Pflicht-Ruhetag
      continue;
    }
    run += 1;
    maxDays += 1;
    maxMinutes += hours * 60;
  }

  return { openDays, maxDays, maxMinutes };
}

/** Fehlermeldung, die auch sagt WARUM es nicht aufgeht. */
/**
 * Die längste Schicht, die an einem NORMALEN offenen Tag dieses Monats
 * überhaupt möglich ist – gemeint ist der kleinste dieser Werte.
 *
 * Erklärt, warum die Decke niedrig liegt: schließt der Laden mittags, ist der
 * längste zusammenhängende Block kurz, und daran hängt alles Weitere.
 */
function laengsteSchichtImMonat(
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
): number {
  let kuerzeste = MAX_SHIFT_HOURS;
  for (const d of dates) {
    const day = dayOf(d);
    if (day.closed) continue;
    const moeglich = maxShiftHoursForWindow(windowLength(day));
    if (moeglich > 0 && moeglich < kuerzeste) kuerzeste = moeglich;
  }
  return kuerzeste;
}

function buildUnmetMessage(
  state: SchedulerState,
  unmet: Employee[],
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
): string {
  const full = monthCapacity(dates, dayOf, PREFERRED_HOURS.VOLLZEIT);
  // Der Chef darf länger und über die Mittagsschließung hinweg – seine Decke
  // liegt entsprechend höher, sonst nennt die Fehlermeldung eine Zahl, die für
  // ihn gar nicht gilt.
  const chef = monthCapacity(dates, dayOf, OWNER_MAX_SHIFT_HOURS);

  // Ein Soll unter der kürzesten Schicht ist ein EIGENER Fehlerfall. Vorher
  // fiel er in die Kapazitäts-Erklärung: Wer 2 h eintrug, bekam einen Vortrag
  // über die 6-Tage-Regel und eine Stundendecke von über 200 h – beides half
  // nicht weiter. Der wahre Grund ist schlicht, dass 2 h keine Schicht ergibt.
  const tooSmall = unmet.filter((e) => e.targetMinutes > 0 && e.targetMinutes < MIN_SHIFT_MINUTES);
  if (tooSmall.length === unmet.length) {
    const who = tooSmall
      .map((e) => `${e.name} (${e.targetMinutes / 60}h)`)
      .join(", ");
    return (
      `Định mức quá nhỏ: ${who}. ` +
      `Ca ngắn nhất là ${MIN_SHIFT_MINUTES / 60}h, nên định mức phải từ ` +
      `${MIN_SHIFT_MINUTES / 60}h trở lên. Hãy sửa ở tab Nhân viên.`
    );
  }

  const missing = unmet
    .map((e) => {
      const short = state.remaining.get(e.id)!;
      const done = (e.targetMinutes - short) / 60;
      if (e.targetMinutes < MIN_SHIFT_MINUTES) {
        return `${e.name} ${e.targetMinutes / 60}h (nhỏ hơn ca ngắn nhất ${MIN_SHIFT_MINUTES / 60}h)`;
      }
      const capMin = e.isOwner ? chef.maxMinutes : full.maxMinutes;
      const overCap = e.targetMinutes > capMin ? ` — vượt trần ${capMin / 60}h` : "";
      return `${e.name} chỉ xếp được ${done}h / ${e.targetMinutes / 60}h${overCap}`;
    })
    .join("; ");

  if (full.maxDays === 0) {
    return (
      `Không xếp được ca nào (${missing}). ` +
      `Tháng này có ${full.openDays} ngày mở cửa nhưng khung giờ làm quá ngắn — ` +
      `không đủ cho cả ca ngắn nhất (3h). Hãy nới khung giờ làm ở tab Cài đặt.`
    );
  }

  // Warum die Decke so niedrig liegt, hängt am Tag, nicht an der 6-Tage-Regel.
  // Die alte Meldung schob es auf die 6-Tage-Regel, obwohl die hier oft gar
  // nicht greift – und behauptete "praktisch weniger", obwohl der Plan die
  // Decke exakt erreicht. Beides führte in die Irre.
  const laengsterBlock = laengsteSchichtImMonat(dates, dayOf);
  const sechsTageGreift = full.maxDays < full.openDays;

  return (
    `Không xếp đủ định mức: ${missing}. ` +
    `Tháng này có ${full.openDays} ngày mở cửa, ca dài nhất mỗi ngày cộng lại ` +
    `được ${full.maxMinutes / 60}h — đó là trần của một người.` +
    (laengsterBlock < MAX_SHIFT_HOURS
      ? ` Trần thấp vì có ngày khung giờ bị cắt: ca dài nhất chỉ ${laengsterBlock}h.`
      : "") +
    (sechsTageGreift
      ? ` Ngoài ra luật tối đa 6 ngày liên tiếp chỉ cho làm ${full.maxDays}/${full.openDays} ngày.`
      : "") +
    ` Hãy giảm định mức, nới khung giờ làm, bớt ngày đóng cửa, hoặc thêm người.`
  );
}

/**
 * Hauptfunktion: erzeugt die Schichten für den Monat.
 * Gibt eine neue Liste generierter Shifts zurück (verändert keine Eingaben).
 */
/**
 * Bezahlte Minuten und Pause eines festen Zeitfensters. Die Pause hängt an der
 * bezahlten Zeit, die bezahlte Zeit an der Pause – deshalb per Fixpunkt.
 */
function fixedShiftPaid(window: DayWindow): { paid: number; pause: number } {
  const presence = window.endMinutes - window.startMinutes;
  let paid = presence;
  for (let i = 0; i < 3; i++) paid = presence - calculatePause(paid);
  return { paid, pause: presence - paid };
}

/**
 * Feste-Schicht-Kräfte (fixedShift, z. B. 6:30–14:30) belegen. Sie laufen NICHT
 * durch die normale Blocklogik und werden von den Reparaturläufen nicht
 * angefasst: ihr Fenster steht fest. Verteilt wird gleichmäßig über den Monat,
 * je Tag genau dieses Fenster, bis das Monats-Soll möglichst genau erreicht ist
 * (nie darüber – ein fester Dienst lässt sich nicht kürzen). Ein Rest bleibt und
 * wird in der Prüfung als Warnung gemeldet.
 */
function placeFixedShiftWorkers(state: SchedulerState, employees: Employee[]): void {
  for (const emp of employees) {
    if (!emp.fixedShift) continue;
    const { paid, pause } = fixedShiftPaid(emp.fixedShift);
    if (paid <= 0) continue;

    const ziel = state.remaining.get(emp.id) ?? emp.targetMinutes;
    const noetig = Math.floor(ziel / paid); // ganze Dienste, nie über das Soll
    if (noetig <= 0) {
      state.remaining.set(emp.id, ziel);
      continue;
    }

    // Erst alle grundsätzlich möglichen Tage sammeln (offen, kein Urlaub),
    // dann gleichmäßig so viele auswählen, wie gebraucht werden.
    const moeglich = state.dates.filter((d) => {
      if (state.dayOf(d).closed) return false;
      return mayWorkOn(emp, d);
    });
    const worked = state.worked.get(emp.id) ?? new Set<string>();
    let gelegt = 0;
    // Gleichmäßige Auswahl mit Beachtung der Sechs-Tage-Regel.
    const schritt = moeglich.length / noetig;
    let cursor = 0;
    for (let k = 0; k < moeglich.length && gelegt < noetig; k++) {
      // Zielindex für gleichmäßige Verteilung; ab da den nächsten freien Tag.
      if (k < Math.floor(cursor)) continue;
      const iso = moeglich[k];
      if (worked.has(iso)) continue;
      if (consecutiveRunLengthWith(worked, iso) > 6) continue;
      state.shifts.push({
        id: nextShiftId(),
        employeeId: emp.id,
        date: iso,
        startMinutes: emp.fixedShift.startMinutes,
        endMinutes: emp.fixedShift.endMinutes,
        pauseMinutes: pause,
        paidMinutes: paid,
        shiftType: "EARLY",
        generated: true,
      });
      worked.add(iso);
      gelegt += 1;
      cursor += schritt;
    }
    state.worked.set(emp.id, worked);
    state.remaining.set(emp.id, ziel - gelegt * paid);
  }
}


export function generateSchedule(input: GenerateInput): Shift[] {
  const weekly = input.employees.filter((e) => e.weeklyHours != null);
  if (weekly.length > 0) {
    const monthly = input.employees.filter((e) => e.weeklyHours == null);
    const existing = monthly.length ? generateSchedule({ ...input, employees: monthly }) : [];
    return generateWeeklySchedule({ ...input, employees: weekly }, existing);
  }
  shiftIdCounter = 0;
  const { year, month, workHours } = input;
  const holidays = input.holidays ?? publicHolidays(year);
  const overrides = input.overrides ?? {};

  const effKeyOf = (isoDate: string): WeekdayKey => effectiveWeekdayKey(isoDate, holidays);
  const dayOf = (isoDate: string): ResolvedDay => resolveDay(workHours, isoDate, holidays, overrides);
  // Nachfrage-Gewicht: geschlossene Tage tragen 0 (bekommen keine Stunden).
  const weightOf = (isoDate: string): number =>
    dayOf(isoDate).closed ? 0 : DAY_WEIGHTS[effKeyOf(isoDate)];

  const dates = datesOfMonth(year, month);

  // Wochenverträge (weeklyHours) in ein Monats-Soll dieses Monats umrechnen –
  // über die offenen Tage. Ab hier arbeitet der Scheduler nur noch mit
  // targetMinutes, egal ob es aus Wochen- oder Monatsangabe stammt.
  const openDays = dates.filter((d) => !dayOf(d).closed).length;
  const employees = input.employees.map((e) => ({
    ...e,
    targetMinutes: monthlyTargetMinutes(e, openDays),
  }));
  azubiIds = new Set(employees.filter((e) => e.employmentType === "AZUBI").map((e) => e.id));
  const totalTargetMin = employees.reduce((sum, e) => sum + e.targetMinutes, 0);
  const totalWeight = dates.reduce((sum, d) => sum + weightOf(d), 0);

  // Offene Tage je ISO-Woche – Grundlage für das Wochen-Soll (weeklyHours).
  const openDaysByWeek: { weekStart: string; openDays: number }[] = [];
  {
    const byWeek = new Map<string, number>();
    for (const d of dates) {
      if (dayOf(d).closed) continue;
      const wk = weekStartOf(d);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1);
    }
    for (const [weekStart, cnt] of [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      openDaysByWeek.push({ weekStart, openDays: cnt });
    }
  }
  // Wochen-Soll je Mitarbeiter mit Wochenvertrag. Ohne weeklyHours bleibt der
  // Eintrag leer und die Verteilung läuft wie bisher rein übers Monats-Soll.
  const weekTarget = new Map<string, Map<string, number>>();
  for (const e of input.employees) {
    if (e.weeklyHours != null && e.weeklyHours > 0) {
      weekTarget.set(e.id, weeklyTargetMinutes(monthlyTargetMinutes(e, openDays), openDaysByWeek));
    }
  }

  // Erst der Boden für die Stoßzeit, dann die Gewichtung auf den Rest.
  // Reicht die Gesamtsumme nicht einmal für den Boden, wird rein nach Gewicht
  // verteilt – dann ist der Monat für die Stoßzeiten-Regel schlicht zu dünn
  // besetzt, und das Dashboard weist die Lücken aus.
  const floors = new Map<string, number>();
  let totalFloor = 0;
  for (const d of dates) {
    const f = peakFloorMinutes(dayOf(d), PEAK_WINDOWS_BY_WEEKDAY[effKeyOf(d)]);
    floors.set(d, f);
    totalFloor += f;
  }

  const rawTarget = new Map<string, number>();
  const spare = totalTargetMin - totalFloor;
  for (const d of dates) {
    if (totalWeight <= 0) {
      rawTarget.set(d, 0);
    } else if (spare >= 0) {
      rawTarget.set(d, floors.get(d)! + (spare * weightOf(d)) / totalWeight);
    } else {
      rawTarget.set(d, (totalTargetMin * weightOf(d)) / totalWeight);
    }
  }

  const dateState = new Map<string, DateState>();
  const worked = new Map<string, Set<string>>();
  const weekendCount = new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const d of dates) dateState.set(d, { totalPaid: 0, latePaid: 0, count: 0 });
  for (const e of employees) {
    worked.set(e.id, new Set());
    weekendCount.set(e.id, 0);
    remaining.set(e.id, e.targetMinutes);
  }

  const seed =
    input.seed ??
    `${year}-${month}-${employees.map((e) => `${e.id}:${e.targetMinutes}`).join("|")}`;

  const employeesById = new Map(employees.map((e) => [e.id, e] as const));
  // Feste-Schicht-Kräfte laufen NICHT durch die normale Blocklogik und die
  // Reparaturläufe (ihr Fenster steht fest); sie werden ganz am Ende belegt.
  const normale = employees.filter((e) => !e.fixedShift);
  const festeKraefte = employees.filter((e) => e.fixedShift);
  const ordered = orderedEmployees(normale);
  const n = ordered.length;

  /**
   * Ein kompletter Belegungsversuch. varyLengths=true mischt die Schichtlängen
   * (4..8 h statt immer die längste); das ist schöner, kann aber bei knappem
   * Soll die Tage aufbrauchen. Deshalb gibt es den zweiten, strengen Versuch.
   */
  function attempt(varyLengths: boolean, salt = "", enforceWeekCap = true): SchedulerState {
    shiftIdCounter = 0;
    const st: SchedulerState = {
      dates,
      rawTarget,
      dateState: new Map(dates.map((d) => [d, { totalPaid: 0, latePaid: 0, count: 0 }])),
      worked: new Map(employees.map((e) => [e.id, new Set<string>()])),
      owners: new Set(employees.filter((e) => e.isOwner).map((e) => e.id)),
      byId: new Map(employees.map((e) => [e.id, e] as const)),
      weekendCount: new Map(employees.map((e) => [e.id, 0])),
      remaining: new Map(employees.map((e) => [e.id, e.targetMinutes])),
      weekTarget,
      shifts: [],
      effKeyOf,
      dayOf,
      peaksOf: (isoDate: string) => PEAK_WINDOWS_BY_WEEKDAY[effKeyOf(isoDate)],
      rng: seededRandom(seed + salt),
      varyLengths,
      enforceWeekCap,
    };

    // Rundenweise, rotierend platzieren: pro Runde eine Schicht je Mitarbeiter,
    // bis jedes Monats-Soll exakt erreicht ist.
    for (let round = 0; ; round++) {
      if (ordered.every((e) => st.remaining.get(e.id)! <= 0)) break;
      let progress = false;
      for (let i = 0; i < n; i++) {
        const emp = ordered[(i + round) % n];
        if (st.remaining.get(emp.id)! <= 0) continue;
        if (placeOneShift(st, emp)) progress = true;
      }
      if (!progress) break; // keine Platzierung mehr möglich
    }
    return st;
  }

  const incomplete = (st: SchedulerState) =>
    normale.some((e) => st.remaining.get(e.id)! > 0);

  // Mehrere Anläufe mit gemischten Längen (jeweils anderer Zufallsstrom).
  // Klappt keiner, wird streng die längste Schicht genommen – damit ist das
  // Ergebnis nie schlechter als ohne Abwechslung.
  let state = attempt(true);
  for (let k = 1; k < 5 && incomplete(state); k++) {
    state = attempt(true, `#${k}`);
  }
  if (incomplete(state)) state = attempt(false);
  // Letzter Rückfall: den Wochen-Deckel lösen. Eine Woche kann durch verkürzte
  // Tage (Override/Feiertag) zu wenig Kapazität für ihr rechnerisches Wochen-Soll
  // haben; dann bliebe das MONATS-Soll offen. Ein exakt getroffenes Monats-Soll
  // geht vor – die Wochenverteilung ist nur so streng, wie sie erfüllbar ist.
  if (incomplete(state)) state = attempt(true, "no-weekcap", false);
  if (incomplete(state)) state = attempt(false, "no-weekcap", false);

  const unmet = normale.filter((e) => state.remaining.get(e.id)! > 0);
  if (unmet.length > 0) {
    // Ein zu hohes Soll ist kein Grund, GAR KEINEN Plan zu liefern. Der
    // Betrieb steht sonst mit leeren Händen da, obwohl fast alles verteilt
    // werden konnte. Geliefert wird, was geht; wer sein Soll nicht erreicht,
    // taucht in der Prüfung als Warnung auf (validateSchedule).
    //
    // Abgebrochen wird nur noch, wenn schon die Eingabe unmöglich ist – ein
    // Soll unter der kürzesten Schicht oder ein Tag ohne nutzbares Fenster.
    // Da hilft kein Teilplan, sondern nur eine Korrektur.
    const hoffnungslos =
      unmet.some((e) => e.targetMinutes > 0 && e.targetMinutes < MIN_SHIFT_MINUTES) ||
      monthCapacity(dates, dayOf).maxDays === 0;
    if (hoffnungslos) {
      throw new Error(buildUnmetMessage(state, unmet, dates, dayOf));
    }
  }

  repairDemand(state, employeesById);
  // Erst danach: die Stundenbilanz steht, jetzt die Form für die Stoßzeit.
  repairPeakCapacity(state, employeesById);
  // ... und der umgekehrte Fall: zu viele Leute in der Stoßzeit.
  repairPeakExcess(state, employeesById);
  balanceShiftTypes(state);
  // Ganz zum Schluss: keine zwei Dienste einer Person zur selben Zeit.
  fixSameEmployeeOverlaps(state);
  // Danach die geteilten Dienste eng zusammenrücken (siehe tightenSplitShifts).
  tightenSplitShifts(state);
  // Zuletzt: kurze Abenddienste auf die Stoßzeit ziehen, soweit die Besetzung
  // des Schließfensters mit fünf bis sechs Personen erhalten bleibt.
  concentrateEveningShifts(state);
  // concentrateEveningShifts kann dabei zwei Dienste einer Person in denselben
  // Abendblock schieben (identische Zeiten). Deshalb NOCH einmal entzerren –
  // der Lauf davor konnte diese erst danach entstandene Überschneidung nicht
  // sehen.
  fixSameEmployeeOverlaps(state);
  // Zum Öffnen mindestens zwei Kräfte (AUFSPERREN): einen zweiten Vormittags-
  // dienst des ersten Blocks auf den Ladenanfang ziehen, falls dort nur einer
  // steht (siehe ensureOpeningStaff).
  ensureOpeningStaff(state);

  // Ganz zum Schluss die Feste-Schicht-Kräfte (6:30–14:30) belegen – unberührt
  // von den Reparaturläufen, damit ihr Fenster fest bleibt.
  placeFixedShiftWorkers(state, festeKraefte);

  // Stabil sortieren: nach Datum, dann Startzeit, dann Mitarbeiter.
  state.shifts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      a.employeeId.localeCompare(b.employeeId),
  );
  return state.shifts;
}
