// ============================================================================
// Zentrales State-Management (ohne externe Bibliothek). Kapselt Schedule,
// LocalStorage-Persistenz und alle Aktionen (Generieren, Bearbeiten, Reset).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Employee, Schedule, Shift } from "../types";
import { generateSchedule } from "../lib/scheduler";
import { analyzeSchedule } from "../lib/analyze";
import { validateSchedule, type ValidationResult } from "../lib/validation";
import { clearState, loadState, saveState, type PersistedState } from "../lib/storage";
import { MIN_PASSWORD_LENGTH, hashPassword, passwordMatches } from "../lib/auth";
import { isRemoteConfigured, loadRemote, saveRemote, type RemoteStatus } from "../lib/remote";
import { createManualShift, updateShiftTimes } from "../lib/shiftOps";
import {
  DEFAULT_WORK_HOURS,
  normalizeWorkHours,
  resolveDay,
  type DateOverride,
  type OverrideMap,
} from "../lib/workHours";
import { datesOfMonth } from "../lib/demand";
import { publicHolidays } from "../lib/holidays";
import { COMPANY_ADDRESS, COMPANY_NAME } from "../lib/company";
import { createInitialSchedule } from "../lib/sampleData";

/**
 * Steht in diesem Stand überhaupt etwas? Maßstab sind Mitarbeiter und
 * Schichten – Firmenname und Monat allein sind noch kein Inhalt.
 */
function hatInhalt(state: PersistedState): boolean {
  return state.schedule.employees.length > 0 || state.schedule.shifts.length > 0;
}

function emptySchedule(): Schedule {
  const now = new Date();
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: [],
    shifts: [],
  };
}

/** Ausnahmen-Array -> nach Datum indizierte Map (für den Scheduler). */
function overridesToMap(list: DateOverride[]): OverrideMap {
  const map: OverrideMap = {};
  for (const ov of list) map[ov.date] = ov;
  return map;
}

/** Migriert einen (evtl. alten) gespeicherten Stand auf das aktuelle Schema. */
function normalizeSchedule(raw: Schedule | undefined): Schedule {
  const base = emptySchedule();
  if (!raw) return base;
  return {
    // Firmenname & Adresse sind fest (không cho sửa) – immer erzwingen.
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: raw.year ?? base.year,
    month: raw.month ?? base.month,
    workHours: normalizeWorkHours(raw.workHours),
    dateOverrides: Array.isArray(raw.dateOverrides) ? raw.dateOverrides : [],
    employees: raw.employees ?? [],
    shifts: raw.shifts ?? [],
    lockedAt: raw.lockedAt,
    printedWeeks: Array.isArray(raw.printedWeeks) ? raw.printedWeeks : [],
  };
}

function newEmployeeId(): string {
  return `emp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function useSchedule() {
  const [schedule, setSchedule] = useState<Schedule>(() => {
    const persisted = loadState();
    // Beim allerersten Öffnen (kein gespeicherter Stand) zeigt die App die
    // Startbelegschaft aus der Angabe des Betriebs, damit sie nicht leer ist.
    return normalizeSchedule(persisted?.schedule ?? createInitialSchedule());
  });
  const [passwordHash, setPasswordHash] = useState<string | undefined>(
    () => loadState()?.passwordHash,
  );
  const [originalShifts, setOriginalShifts] = useState<Shift[]>(() => {
    const persisted = loadState();
    return persisted?.originalShifts ?? [];
  });
  const [genError, setGenError] = useState<string | null>(null);
  // Jeder Klick auf "Tạo lịch" soll einen ANDEREN gültigen Plan liefern. Der
  // Scheduler ist deterministisch: gleicher Seed => gleicher Plan. Ohne diesen
  // Zähler kam bei unveränderten Mitarbeitern jedes Mal derselbe Plan heraus –
  // man musste erst Stunden ändern, um Abwechslung zu bekommen.
  const genNonce = useRef(0);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>(
    isRemoteConfigured ? "idle" : "off",
  );

  // Immer sofort lokal sichern – das ist der Offline-Puffer.
  useEffect(() => {
    saveState({ schedule, originalShifts, passwordHash });
  }, [schedule, originalShifts, passwordHash]);

  // Letzter Stand für Zugriffe außerhalb des Renders (siehe Erst-Upload).
  const latest = useRef<PersistedState>({ schedule, originalShifts, passwordHash });
  useEffect(() => {
    latest.current = { schedule, originalShifts, passwordHash };
  }, [schedule, originalShifts, passwordHash]);

  // Beim Start den Stand der Filiale aus der gemeinsamen Datenbank holen.
  // Vorher darf nicht hochgeladen werden, sonst überschreibt der lokale
  // (evtl. leere) Stand die Daten in der Datenbank.
  const hydrated = useRef(!isRemoteConfigured);
  useEffect(() => {
    if (!isRemoteConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadRemote();
        if (cancelled) return;
        if (remote?.schedule) {
          setSchedule(normalizeSchedule(remote.schedule));
          setOriginalShifts(remote.originalShifts ?? []);
          setPasswordHash(remote.passwordHash);
        } else if (hatInhalt(latest.current)) {
          // Noch keine Zeile für diese Filiale: lokalen Stand hochladen –
          // aber nur, wenn lokal überhaupt etwas drinsteht. Eine leere Zeile
          // anzulegen bringt nichts und macht aus "noch nichts eingetragen"
          // versehentlich einen gespeicherten Leerstand.
          await saveRemote(latest.current);
        }
        if (!cancelled) setRemoteStatus("idle");
        // NUR nach erfolgreichem Lesen darf hochgeladen werden.
        if (!cancelled) hydrated.current = true;
      } catch {
        // Lesen fehlgeschlagen: hydrated bleibt false, es wird NICHTS
        // hochgeladen. Sonst überschreibt der leere lokale Stand die Daten in
        // der Datenbank – genau so ist eine Filiale schon einmal leer geräumt
        // worden: Netzfehler beim Start, danach ein Klick, und weg war alles.
        if (!cancelled) setRemoteStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Änderungen gebündelt hochladen (nicht bei jedem Tastendruck).
  useEffect(() => {
    if (!isRemoteConfigured || !hydrated.current) return;
    const timer = window.setTimeout(() => {
      setRemoteStatus("saving");
      saveRemote({ schedule, originalShifts, passwordHash })
        .then(() => setRemoteStatus("idle"))
        .catch(() => setRemoteStatus("error"));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [schedule, originalShifts, passwordHash]);

  // Offene Tage des Monats – für die Umrechnung von Wochenverträgen (weeklyHours)
  // ins Monats-Soll (siehe contract.ts / validateSchedule).
  const openDays = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const overrides = overridesToMap(schedule.dateOverrides);
    return datesOfMonth(schedule.year, schedule.month).filter(
      (d) => !resolveDay(schedule.workHours, d, holidays, overrides).closed,
    ).length;
  }, [schedule.year, schedule.month, schedule.workHours, schedule.dateOverrides]);

  const validation: ValidationResult = useMemo(
    () => validateSchedule(schedule.employees, schedule.shifts, schedule.year, openDays),
    [schedule.employees, schedule.shifts, schedule.year, openDays],
  );

  /**
   * Tage, an denen eine Stoßzeit unterbesetzt ist.
   *
   * Das ist bewusst KEIN Validierungsfehler: der Plan ist rechnerisch korrekt,
   * es sind schlicht zu wenige Leute im Haus. Vorher fiel das nirgends auf –
   * der Scheduler tut sein Bestes und schweigt, wenn es nicht reicht.
   */
  const peakGaps = useMemo(() => {
    if (schedule.shifts.length === 0) return [];
    return analyzeSchedule({
      year: schedule.year,
      month: schedule.month,
      workHours: schedule.workHours,
      overrides: overridesToMap(schedule.dateOverrides),
      employees: schedule.employees,
      shifts: schedule.shifts,
    }).peakViolations;
  }, [
    schedule.year,
    schedule.month,
    schedule.workHours,
    schedule.dateOverrides,
    schedule.employees,
    schedule.shifts,
  ]);

  /**
   * Gesperrt = eine Woche dieses Monats wurde bereits ausgedruckt. Ab da darf
   * sich am Plan nichts mehr ändern, sonst weicht das Papier im Laden vom
   * Stand im System ab. Alle ändernden Aktionen prüfen das selbst – die
   * Oberfläche allein zu deaktivieren würde die Regel nicht durchsetzen.
   */
  const isLocked = Boolean(schedule.lockedAt);

  // ----- Firma / Monat / Öffnungszeiten -----
  const updateMeta = useCallback((patch: Partial<Schedule>) => {
    setSchedule((s) => {
      // Ein Monatswechsel beginnt einen neuen Plan: die Sperre des alten
      // Monats darf nicht mitwandern.
      const monthChanged =
        (patch.year !== undefined && patch.year !== s.year) ||
        (patch.month !== undefined && patch.month !== s.month);
      if (monthChanged) {
        return { ...s, ...patch, lockedAt: undefined, printedWeeks: [] };
      }
      return { ...s, ...patch };
    });
  }, []);

  /**
   * Sofort speichern, ohne die Entprell-Zeit abzuwarten.
   *
   * Der normale Upload wartet eine Sekunde, damit nicht bei jedem Tastendruck
   * geschrieben wird. Für Sperren und Entsperren ist das zu langsam: wer
   * direkt nach dem Klick neu lädt oder die App wechselt, holt sich beim
   * nächsten Start wieder den alten Stand aus der Datenbank – die Sperre wäre
   * dann scheinbar von selbst zurückgekommen.
   */
  const pushNow = useCallback(async (state: PersistedState) => {
    saveState(state);
    if (!isRemoteConfigured || !hydrated.current) return;
    setRemoteStatus("saving");
    try {
      await saveRemote(state);
      setRemoteStatus("idle");
    } catch {
      setRemoteStatus("error");
    }
  }, []);

  /**
   * Passwort der Filiale ändern. Gibt eine Meldung zurück oder null bei Erfolg.
   *
   * Das alte Passwort wird abgefragt, damit nicht jeder, der gerade vor dem
   * offenen Tablet steht, die Filiale aussperren kann. Geschrieben wird sofort
   * (pushNow), nicht über die Ein-Sekunden-Sammlung: wer nach dem Ändern gleich
   * neu lädt, säße sonst vor dem alten Passwort.
   */
  const changePassword = useCallback(
    async (alt: string, neu: string): Promise<string | null> => {
      if (!(await passwordMatches(alt, latest.current.passwordHash))) {
        return "Mật khẩu hiện tại không đúng.";
      }
      const sauber = neu.trim();
      if (sauber.length < MIN_PASSWORD_LENGTH) {
        return `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
      }
      const neuerHash = await hashPassword(sauber);
      setPasswordHash(neuerHash);
      await pushNow({ ...latest.current, passwordHash: neuerHash });
      return null;
    },
    [pushNow],
  );

  /** Merkt eine gedruckte Woche und sperrt den Monat beim ersten Mal. */
  const markWeekPrinted = useCallback(
    (weekStart: string) => {
      const current = latest.current;
      const weeks = current.schedule.printedWeeks ?? [];
      const next: Schedule = {
        ...current.schedule,
        printedWeeks: weeks.includes(weekStart) ? weeks : [...weeks, weekStart].sort(),
        lockedAt: current.schedule.lockedAt ?? new Date().toISOString(),
      };
      setSchedule(next);
      void pushNow({ ...current, schedule: next });
    },
    [pushNow],
  );

  /** Sperre wieder aufheben (die Oberfläche fragt vorher nach). */
  const unlockMonth = useCallback(() => {
    const current = latest.current;
    const next: Schedule = { ...current.schedule, lockedAt: undefined };
    setSchedule(next);
    void pushNow({ ...current, schedule: next });
  }, [pushNow]);

  // ----- Mitarbeiter -----
  const addEmployee = useCallback((data: Omit<Employee, "id">): string | null => {
    if (latest.current.schedule.lockedAt) return null; // Monat gedruckt und gesperrt
    const emp: Employee = {
      ...data,
      id: newEmployeeId(),
      name: data.name.trim() || "Nhân viên mới",
    };
    setSchedule((s) => {
      if (s.lockedAt) return s;
      return { ...s, employees: [...s.employees, emp] };
    });
    return emp.id;
  }, []);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      };
    });
  }, []);

  const removeEmployee = useCallback((id: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        employees: s.employees.filter((e) => e.id !== id),
        shifts: s.shifts.filter((sh) => sh.employeeId !== id),
      };
    });
  }, []);

  // ----- Generierung -----
  const generate = useCallback(() => {
    if (isLocked) return;
    setGenError(null);
    try {
      const shifts = generateSchedule({
        year: schedule.year,
        month: schedule.month,
        workHours: schedule.workHours,
        overrides: overridesToMap(schedule.dateOverrides),
        employees: schedule.employees,
        // Frischer Seed pro Klick => jedes Mal ein anderer gültiger Plan.
        seed: `${schedule.year}-${schedule.month}-${Date.now()}-${genNonce.current++}`,
      });
      setSchedule((s) => ({ ...s, shifts }));
      setOriginalShifts(shifts.map((sh) => ({ ...sh })));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    }
  }, [
    schedule.year,
    schedule.month,
    schedule.workHours,
    schedule.dateOverrides,
    schedule.employees,
    isLocked,
  ]);

  const resetToOriginal = useCallback(() => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return { ...s, shifts: originalShifts.map((sh) => ({ ...sh })) };
    });
  }, [originalShifts]);

  const resetAll = useCallback(() => {
    clearState();
    setSchedule(emptySchedule());
    setOriginalShifts([]);
    setGenError(null);
  }, []);

  const saveNow = useCallback(() => {
    saveState({ schedule, originalShifts, passwordHash });
  }, [schedule, originalShifts, passwordHash]);

  // ----- Ausnahmen je Datum -----
  const upsertOverride = useCallback((override: DateOverride) => {
    setSchedule((s) => {
      const rest = s.dateOverrides.filter((o) => o.date !== override.date);
      const next = [...rest, override].sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, dateOverrides: next };
    });
  }, []);

  const removeOverride = useCallback((date: string) => {
    setSchedule((s) => ({
      ...s,
      dateOverrides: s.dateOverrides.filter((o) => o.date !== date),
    }));
  }, []);

  // ----- Schicht-Bearbeitung -----
  const findShift = useCallback(
    (employeeId: string, date: string): Shift | undefined =>
      schedule.shifts.find((s) => s.employeeId === employeeId && s.date === date),
    [schedule.shifts],
  );

  const editShiftTimes = useCallback(
    (
      shiftId: string,
      changes: Partial<Pick<Shift, "startMinutes" | "endMinutes" | "pauseMinutes">>,
    ) => {
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        return {
          ...s,
          shifts: s.shifts.map((sh) => (sh.id === shiftId ? updateShiftTimes(sh, changes) : sh)),
        };
      });
    },
    [],
  );

  const addShift = useCallback(
    (employeeId: string, date: string, start: number, end: number, pause: number) => {
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        const exists = s.shifts.some((sh) => sh.employeeId === employeeId && sh.date === date);
        if (exists) return s;
        return { ...s, shifts: [...s.shifts, createManualShift(employeeId, date, start, end, pause)] };
      });
    },
    [],
  );

  const deleteShift = useCallback((shiftId: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return { ...s, shifts: s.shifts.filter((sh) => sh.id !== shiftId) };
    });
  }, []);

  /** Markiert einen Tag als "Frei": entfernt eine bestehende Schicht. */
  const setFrei = useCallback((employeeId: string, date: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        shifts: s.shifts.filter((sh) => !(sh.employeeId === employeeId && sh.date === date)),
      };
    });
  }, []);

  /** Verschiebt eine Schicht zu einem anderen Mitarbeiter (gleicher Tag). */
  const moveShiftToEmployee = useCallback((shiftId: string, targetEmployeeId: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      const shift = s.shifts.find((sh) => sh.id === shiftId);
      if (!shift) return s;
      const conflict = s.shifts.some(
        (sh) => sh.employeeId === targetEmployeeId && sh.date === shift.date,
      );
      if (conflict) return s;
      return {
        ...s,
        shifts: s.shifts.map((sh) =>
          sh.id === shiftId ? { ...sh, employeeId: targetEmployeeId, generated: false } : sh,
        ),
      };
    });
  }, []);

  return {
    schedule,
    originalShifts,
    validation,
    peakGaps,
    openDays,
    isLocked,
    markWeekPrinted,
    unlockMonth,
    genError,
    hasOriginal: originalShifts.length > 0,
    updateMeta,
    addEmployee,
    updateEmployee,
    removeEmployee,
    changePassword,
    hasOwnPassword: passwordHash !== undefined,
    generate,
    resetToOriginal,
    resetAll,
    remoteStatus,
    isRemoteConfigured,
    saveNow,
    upsertOverride,
    removeOverride,
    findShift,
    editShiftTimes,
    addShift,
    deleteShift,
    setFrei,
    moveShiftToEmployee,
  };
}

export type UseScheduleReturn = ReturnType<typeof useSchedule>;
