// ============================================================================
// Validierung des Dienstplans gegen alle geforderten Regeln.
// ============================================================================

import {
  AZUBI_MAX_MONTHLY_HOURS,
  OWNER_MAX_SHIFT_HOURS,
  type Employee,
  type Shift,
} from "../types";
import { monthlyTargetMinutes } from "./contract";
import { calculatePause } from "./time";
import { maxConsecutiveRun } from "./consecutive";
import { weekStartOf } from "./weeks";
import { validPause } from "./staffing";
import { mayWorkOn } from "./availability";

export type ValidationError = {
  employeeId?: string;
  date?: string;
  message: string;
  /**
   * "error" = der Plan ist unzulässig und muss korrigiert werden.
   * "warning" = der Plan ist benutzbar, etwas passt nur nicht ideal.
   *
   * Ein zu hohes Monats-Soll ist eine WARNUNG: der Plan bleibt gültig, es
   * fehlen nur Stunden, die der Monat gar nicht hergibt. Das als Fehler zu
   * führen hieße, dem Betrieb einen brauchbaren Plan vorzuenthalten, weil eine
   * Zahl in der Mitarbeiterliste zu groß ist.
   */
  severity?: "error" | "warning";
};

export type EmployeeSummary = {
  employee: Employee;
  assignedMinutes: number;
  targetMinutes: number;
  diffMinutes: number; // assigned - target
  maxConsecutiveDays: number;
  shiftCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  summaries: EmployeeSummary[];
};

/**
 * Höchste bezahlte Zeit an einem Tag. Der Chef darf 10 Stunden, alle anderen
 * 9 – siehe OWNER_MAX_SHIFT_HOURS. Beide Werte liegen unter der Grenze des
 * Arbeitszeitgesetzes (§ 3 ArbZG: bis zu 10 Stunden, wenn im Halbjahr auf 8
 * ausgeglichen).
 */
const MAX_PAID_MINUTES = 9 * 60;
const MAX_PAID_MINUTES_OWNER = OWNER_MAX_SHIFT_HOURS * 60;
const MAX_CONSECUTIVE_DAYS = 6;

export function validateSchedule(
  employees: Employee[],
  shifts: Shift[],
  /** Jahr des geplanten Monats. Viet Cuisine verwaltet keinen Urlaub mehr, der
   *  Parameter bleibt aber für die einheitliche Signatur erhalten. */
  _year: number = new Date().getFullYear(),
  /**
   * Offene Tage des geplanten Monats – nötig, um Wochenverträge (weeklyHours)
   * in ein Monats-Soll umzurechnen. Fehlt der Wert, gilt targetMinutes direkt.
   */
  openDays?: number,
): ValidationResult {
  const errors: ValidationError[] = [];
  const sollOf = (e: Employee): number =>
    openDays != null ? monthlyTargetMinutes(e, openDays) : e.targetMinutes;
  const employeeById = new Map(employees.map((e) => [e.id, e] as const));

  // Viet Cuisine verwaltet keinen Urlaub – deshalb keine Urlaubsprüfung.

  // Azubi: höchstens 43 Stunden im Monat. Eine WARNUNG, kein Riegel – ob mehr
  // erlaubt ist, steht im Ausbildungsvertrag und nicht in diesem Programm.
  for (const emp of employees) {
    if (emp.employmentType !== "AZUBI") continue;
    const stunden = emp.targetMinutes / 60;
    if (stunden > AZUBI_MAX_MONTHLY_HOURS) {
      errors.push({
        employeeId: emp.id,
        severity: "warning",
        message:
          `${emp.name}: học nghề ${stunden}h/tháng, vượt mức ${AZUBI_MAX_MONTHLY_HOURS}h.`,
      });
    }
  }

  // Für Kylan gibt es bewusst KEINE Zahlengrenzen bei der Belegschaft –
  // weder für die Anzahl der Beschäftigten noch eine eigene Stundendecke für
  // Minijobs. Siehe Kommentar in types.ts.
  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const emp of employees) shiftsByEmployee.set(emp.id, []);
  for (const shift of shifts) {
    if (!shiftsByEmployee.has(shift.employeeId)) {
      shiftsByEmployee.set(shift.employeeId, []);
    }
    shiftsByEmployee.get(shift.employeeId)!.push(shift);
  }

  // Regeln je einzelner Schicht.
  for (const shift of shifts) {
    const presence = shift.endMinutes - shift.startMinutes;
    const expectedPaid = presence - shift.pauseMinutes;
    const expectedPause = calculatePause(shift.paidMinutes);
    const employee = employeeById.get(shift.employeeId);
    if (employee && !mayWorkOn(employee, shift.date)) errors.push({ employeeId: employee.id, date: shift.date,
      message: `${employee.name}: đã xếp vào ngày không thể làm ${shift.date}.`,
    });
    if (shift.pauseStartMinutes != null && !validPause(shift)) errors.push({ employeeId: shift.employeeId, date: shift.date,
      message: `Giờ nghỉ không hợp lệ ngày ${shift.date}.`,
    });
    if (employee?.weeklyHours != null && shift.pauseMinutes > 0 && shift.pauseStartMinutes == null) errors.push({ employeeId: shift.employeeId, date: shift.date,
      message: `Chưa xếp giờ bắt đầu nghỉ ngày ${shift.date}; cần giờ nghỉ cụ thể để kiểm tra đủ người.`,
    });

    if (shift.endMinutes <= shift.startMinutes) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ ra không sau giờ vào (${shift.date}).`,
      });
    }
    const paidLimit = employeeById.get(shift.employeeId)?.isOwner
      ? MAX_PAID_MINUTES_OWNER
      : MAX_PAID_MINUTES;
    if (shift.paidMinutes > paidLimit) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Quá ${paidLimit / 60} giờ công ngày ${shift.date}.`,
      });
    }
    if (shift.paidMinutes !== expectedPaid) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ công không khớp giờ vào/ra/nghỉ ngày ${shift.date}.`,
      });
    }
    if (shift.pauseMinutes !== expectedPause) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Sai giờ nghỉ ngày ${shift.date}: ${shift.pauseMinutes} thay vì ${expectedPause} phút.`,
      });
    }
  }

  const summaries: EmployeeSummary[] = [];

  for (const emp of employees) {
    const empShifts = shiftsByEmployee.get(emp.id) ?? [];

    // Höchstens ein Dienst pro Tag.
    // Zwei Dienste an einem Tag sind erlaubt, solange sie sich nicht
    // überschneiden – mittags und abends bei einem Laden, der zwischendurch
    // schließt. Verboten bleibt nur, was sich überlappt.
    const seenDates = new Set<string>();
    for (const shift of empShifts) {
      const ueberschneidet = empShifts.some(
        (a) =>
          a !== shift &&
          a.date === shift.date &&
          a.startMinutes < shift.endMinutes &&
          shift.startMinutes < a.endMinutes,
      );
      if (ueberschneidet && !seenDates.has(shift.date)) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `Có nhiều hơn một ca ngày ${shift.date}.`,
        });
      }
      seenDates.add(shift.date);
    }

    const assignedMinutes = empShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
    for (const date of seenDates) {
      const paid = empShifts.filter((shift) => shift.date === date).reduce((sum, shift) => sum + shift.paidMinutes, 0);
      const limit = emp.isOwner ? MAX_PAID_MINUTES_OWNER : MAX_PAID_MINUTES;
      if (paid > limit) errors.push({ employeeId: emp.id, date,
        message: `${emp.name}: tổng giờ công ngày ${date} vượt ${limit / 60} giờ.`,
      });
    }
    const maxRun = maxConsecutiveRun(new Set(empShifts.map((s) => s.date)));
    const soll = sollOf(emp);

    if (emp.weeklyHours != null) {
      const weeks = new Map<string, { paid: number; dates: Set<string> }>();
      for (const shift of empShifts) {
        const week = weekStartOf(shift.date);
        const total = weeks.get(week) ?? { paid: 0, dates: new Set<string>() };
        total.paid += shift.paidMinutes;
        total.dates.add(shift.date);
        weeks.set(week, total);
      }
      for (const [week, total] of weeks) {
        if (total.paid > Math.round(emp.weeklyHours * 60)) {
          errors.push({
            employeeId: emp.id,
            date: week,
            message: `${emp.name}: tuần ${week} xếp ${total.paid / 60}h, vượt hợp đồng ${emp.weeklyHours}h/tuần.`,
          });
        }
        const maxDays = Math.min(6, emp.maxDaysPerWeek ?? 6, emp.isOwner ? 5 : 6);
        if (total.dates.size > maxDays) {
          errors.push({
            employeeId: emp.id,
            date: week,
            message: `${emp.name}: tuần ${week} làm ${total.dates.size} ngày, vượt giới hạn ${maxDays} ngày/tuần.`,
          });
        }
      }
    }

    if (assignedMinutes !== soll) {
      // Zu WENIG verteilt heißt: der Monat gibt nicht mehr her (oder eine feste
      // Schicht trifft das Soll nicht ganz genau) – Warnung. Zu VIEL wäre ein
      // echter Fehler im Plan.
      const zuViel = assignedMinutes < soll;
      errors.push({
        employeeId: emp.id,
        severity: zuViel ? "warning" : "error",
        message: zuViel
          ? `${emp.name}: mới xếp được ${assignedMinutes / 60}h / ${soll / 60}h — tháng này không đủ ngày cho định mức đó.`
          : `${emp.name}: xếp quá giờ định mức: ${assignedMinutes / 60} h thay vì ${soll / 60} h.`,
      });
    }
    if (maxRun > MAX_CONSECUTIVE_DAYS) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: làm quá 6 ngày liên tiếp (${maxRun}).`,
      });
    }

    summaries.push({
      employee: emp,
      assignedMinutes,
      targetMinutes: soll,
      diffMinutes: assignedMinutes - soll,
      maxConsecutiveDays: maxRun,
      shiftCount: empShifts.length,
    });
  }

  // Warnungen machen den Plan nicht ungültig – sonst blockiert eine zu große
  // Zahl in der Mitarbeiterliste das Drucken eines sonst brauchbaren Plans.
  const echteFehler = errors.filter((e) => e.severity !== "warning");
  return { valid: echteFehler.length === 0, errors, summaries };
}
