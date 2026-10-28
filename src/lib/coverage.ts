// ============================================================================
// Mindestbesetzung je offenem Zeitfenster – HARTE Regel „Trong giờ mở cửa".
//
// Der Laden darf zu keiner offenen Minute unter die Mindestbesetzung fallen
// (Standard: 2 Personen). Diese Datei berechnet, WO das verletzt ist – sowohl
// für die Validierung (harter Fehler) als auch, damit der Scheduler gezielt
// nachbessern kann. Nur die Regel „Trong giờ mở cửa" (minStaff der Grundregel)
// zählt hier hart; Stoßzeit/Schluss bleiben weiche Hinweise.
// ============================================================================

import type { Employee, Shift } from "../types";
import { datesOfMonth, parseIsoDate, weekdayKeyOf, WEEKDAY_LABELS_VI, type WeekdayKey } from "./demand";
import { publicHolidays } from "./holidays";
import { isEmployedOn, worksOnWeekday } from "./availability";
import { effectiveWeekdayKey, resolveDay, type OverrideMap, type WorkHoursConfig } from "./workHours";
import { STAFFING_RULES, coveragePoints, ruleRange, workingAt, type StaffingRule } from "./staffing";

/** Die Grundregel „suốt giờ mở cửa" – ihre minStaff ist die harte Untergrenze. */
export function baselineRule(rules: readonly StaffingRule[] = STAFFING_RULES): StaffingRule | undefined {
  return rules.find((r) => r.label === "Trong giờ mở cửa") ?? rules.find((r) => !r.scaled && !r.weekdays);
}

export type CoverageGap = {
  date: string;
  /** Beginn/Ende der Unterbesetzung (Minuten ab Mitternacht). */
  startMinutes: number;
  endMinutes: number;
  /** Tatsächliche Besetzung in diesem Abschnitt. */
  have: number;
  /** Geforderte Mindestbesetzung (Grundregel). */
  need: number;
};

/**
 * Alle Abschnitte, in denen während der Öffnung weniger als die Mindestzahl im
 * Dienst ist. Nur Mitarbeiter, die an dem Tag ÜBERHAUPT arbeiten dürfen, zählen
 * (ein Dienst an einem freien Tag ist ein anderer, eigener Fehler).
 */
export function coverageGaps(
  employees: Employee[],
  shifts: Shift[],
  workHours: WorkHoursConfig,
  year: number,
  month: number,
  overrides: OverrideMap = {},
  rules: readonly StaffingRule[] = STAFFING_RULES,
  holidays: Set<string> = publicHolidays(year),
): CoverageGap[] {
  const rule = baselineRule(rules);
  if (!rule) return [];

  const byDate = new Map<string, Shift[]>();
  for (const s of shifts) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }

  const rosterIds = new Set(employees.map((e) => e.id));
  const gaps: CoverageGap[] = [];
  for (const date of datesOfMonth(year, month)) {
    const day = resolveDay(workHours, date, holidays, overrides);
    if (day.closed) continue;
    const weekday = effectiveWeekdayKey(date, holidays);
    const need = ruleRange(rule, weekday).minStaff;
    if (need <= 0) continue;

    // Nur Dienste von Mitarbeitern aus dem aktuellen Roster zählen.
    const onDay = (byDate.get(date) ?? []).filter((s) => rosterIds.has(s.employeeId));
    for (const window of rule.windows(day.blocks)) {
      const points = coveragePoints(onDay, window.startMinutes, window.endMinutes);
      const edges = [window.startMinutes, ...points, window.endMinutes];
      for (let i = 0; i < edges.length - 1; i++) {
        const from = edges[i];
        const to = edges[i + 1];
        if (to <= from) continue;
        const mid = (from + to) / 2;
        const have = onDay.filter((s) => workingAt(s, mid)).length;
        if (have < need) {
          const last = gaps[gaps.length - 1];
          if (last && last.date === date && last.endMinutes === from && last.have === have && last.need === need) {
            last.endMinutes = to; // benachbarte gleiche Lücken zusammenfassen
          } else {
            gaps.push({ date, startMinutes: from, endMinutes: to, have, need });
          }
        }
      }
    }
  }
  return gaps;
}

/** Kurzdatum „05" aus „2026-10-05". */
function dayNum(iso: string): string {
  return iso.slice(8, 10);
}

/**
 * Lesbarer Grund, WARUM der Plan blockiert: welche Wochentage unterbesetzt sind
 * und dass zu viele Leute an dem Tag fest frei haben. Fester freier Tag richtet
 * sich nach dem ECHTEN Wochentag (nghỉ T2 = Montag), deshalb hier weekdayKeyOf.
 * Gibt null zurück, wenn es keine Lücke gibt.
 */
export function coverageBlockReason(
  employees: Employee[],
  gaps: CoverageGap[],
  month: number,
): string | null {
  if (gaps.length === 0) return null;

  const datesByWeekday = new Map<WeekdayKey, Set<string>>();
  for (const gap of gaps) {
    const weekday = weekdayKeyOf(parseIsoDate(gap.date));
    const set = datesByWeekday.get(weekday) ?? new Set<string>();
    set.add(gap.date);
    datesByWeekday.set(weekday, set);
  }

  const lines: string[] = [];
  for (const [weekday, dateSet] of datesByWeekday) {
    const dates = [...dateSet].sort();
    // An dem Tag beschäftigt UND an diesem Wochentag grundsätzlich verfügbar?
    const employedThatDay = (e: Employee) => dates.some((d) => isEmployedOn(e, d));
    const roster = employees.filter(employedThatDay);
    const available = roster.filter((e) => worksOnWeekday(e, dates[0]));
    const off = roster.filter((e) => !worksOnWeekday(e, dates[0]));
    const label = WEEKDAY_LABELS_VI[weekday];
    const namesText = available.length ? ` (${available.map((e) => e.name).join(", ")})` : "";
    lines.push(
      `• ${label} ngày ${dates.map(dayNum).join(", ")}/${month}: cần tối thiểu 2 người suốt giờ mở cửa, ` +
        `nhưng ${off.length}/${roster.length} người nghỉ cố định ${label}, chỉ còn ${available.length} người làm được${namesText}. ` +
        `Hãy bớt người nghỉ ${label} (hoặc tăng số ngày làm/tuần) rồi tạo lại.`,
    );
  }

  return `Chưa tạo được lịch — có khung giờ mở cửa không đủ 2 người:\n${lines.join("\n")}`;
}
