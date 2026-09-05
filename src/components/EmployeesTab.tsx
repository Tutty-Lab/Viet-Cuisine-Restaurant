import { useCallback, useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { splitTargetHours } from "../lib/splitTargetHours";
import { isDayClosed, resolveDay } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";
import { datesOfMonth } from "../lib/demand";
import { monthlyTargetMinutes } from "../lib/contract";
import { employmentLabelVi, employmentShortVi } from "../lib/employment";
import {
  vacationDatesInMonth,
  vacationDaysInYear,
  vacationEntitlement,
} from "../lib/availability";
import { VacationPicker } from "./VacationPicker";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/** Feste Frühschicht: 6:30–14:30. */
const FIXED_START = 6 * 60 + 30;
const FIXED_END = 14 * 60 + 30;

/** Số ngày làm (= số ca) cho một mục tiêu, hoặc thông báo lỗi. */
function splitInfo(targetHours: number, type: EmploymentType): { ok: boolean; text: string } {
  if (targetHours <= 0) return { ok: true, text: "—" };
  try {
    const parts = splitTargetHours(Math.round(targetHours), type);
    return { ok: true, text: `${parts.length} ca` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "không hợp lệ" };
  }
}

/**
 * Entwurf, während im Blatt getippt wird. Die Wochenstunden sind ein STRING,
 * damit man das Feld leeren kann, ohne dass es auf 0 zurückspringt.
 */
type Draft = {
  name: string;
  employmentType: EmploymentType;
  weekly: string;
  fixed: boolean;
  vacationDates: string[];
};

function draftFrom(emp?: Employee): Draft {
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    weekly: emp?.weeklyHours != null ? String(emp.weeklyHours) : "39",
    fixed: !!emp?.fixedShift,
    vacationDates: emp?.vacationDates ?? [],
  };
}

/** Entwurf -> Mitarbeiter-Felder (ohne id). */
function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const weekly = Math.max(0, Math.round(Number(d.weekly) || 0));
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    targetMinutes: 0, // wird je Monat aus weeklyHours abgeleitet (contract.ts)
    weeklyHours: weekly,
    fixedShift: d.fixed ? { startMinutes: FIXED_START, endMinutes: FIXED_END } : undefined,
    vacationDates: d.vacationDates.length > 0 ? [...d.vacationDates].sort() : undefined,
  };
}

export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, addEmployee, updateEmployee, removeEmployee } = store;
  const locked = Boolean(schedule.lockedAt);

  const holidays = useMemo(() => publicHolidays(schedule.year), [schedule.year]);
  const overrides = useMemo(
    () => Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o])),
    [schedule.dateOverrides],
  );
  const isClosed = useCallback(
    (iso: string) => isDayClosed(schedule.workHours, iso, holidays, overrides),
    [schedule.workHours, holidays, overrides],
  );
  const openDays = useMemo(
    () =>
      datesOfMonth(schedule.year, schedule.month).filter(
        (d) => !resolveDay(schedule.workHours, d, holidays, overrides).closed,
      ).length,
    [schedule.year, schedule.month, schedule.workHours, holidays, overrides],
  );

  // null = zu; "new" = anlegen; sonst = die id, die bearbeitet wird.
  const [offen, setOffen] = useState<null | "new" | string>(null);
  const bearbeitet = useMemo(
    () =>
      typeof offen === "string" && offen !== "new"
        ? schedule.employees.find((e) => e.id === offen)
        : undefined,
    [offen, schedule.employees],
  );

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          Nhân viên
          {schedule.employees.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">
              {schedule.employees.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => setOffen("new")}
          disabled={locked}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          + Thêm
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Giờ nhập theo <b>tuần</b>. Định mức tháng = giờ/tuần × số ngày mở ÷ 6 (nghỉ thứ 2).
        Tháng này có <b>{openDays}</b> ngày mở. Bấm vào một người để sửa.
      </p>

      {locked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khoá vì đã in — mở khoá ở tab <b>Bảng chấm công</b> để sửa nhân viên.
        </div>
      )}

      {schedule.employees.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          Chưa có nhân viên. Bấm <b>+ Thêm</b> để tạo.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedule.employees.map((emp) => (
            <li key={emp.id}>
              <button
                onClick={() => setOffen(emp.id)}
                className="w-full text-left rounded-lg border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <EmployeeSummaryRow emp={emp} openDays={openDays} year={schedule.year} />
                <span className="text-slate-300 text-lg leading-none">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <button
          onClick={() => setOffen("new")}
          aria-label="Thêm nhân viên"
          className="sm:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-slate-900 text-white text-2xl shadow-lg active:bg-slate-700 flex items-center justify-center"
        >
          +
        </button>
      )}

      {offen !== null && !locked && (
        <EmployeeSheet
          key={bearbeitet?.id ?? "new"}
          employee={bearbeitet}
          year={schedule.year}
          month={schedule.month}
          openDays={openDays}
          isClosed={isClosed}
          onClose={() => setOffen(null)}
          onSave={(felder) => {
            if (bearbeitet) updateEmployee(bearbeitet.id, felder);
            else addEmployee(felder);
            setOffen(null);
          }}
          onDelete={
            bearbeitet
              ? () => {
                  removeEmployee(bearbeitet.id);
                  setOffen(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

/** Kompakte Zeile in der Liste: Name, Art, Wochenstunden, Besonderheiten. */
function EmployeeSummaryRow({
  emp,
  openDays,
  year,
}: {
  emp: Employee;
  openDays: number;
  year: number;
}) {
  const monatH = monthlyTargetMinutes(emp, openDays) / 60;
  const info = splitInfo(monatH, emp.employmentType);
  const urlaubJahr = vacationDaysInYear(emp, year);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900 truncate">{emp.name}</span>
        <span className="shrink-0 rounded bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5">
          {employmentShortVi(emp.employmentType)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span>
          {emp.weeklyHours ?? 0}h/tuần · {monatH > 0 ? `${monatH}h · ` : ""}
          <span className={info.ok ? "" : "text-rose-600"}>{info.text}</span>
        </span>
        {emp.fixedShift ? (
          <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">
            ca cố định 6:30–14:30
          </span>
        ) : null}
        {urlaubJahr > 0 ? (
          <span className="text-slate-400">· nghỉ {urlaubJahr} ngày/năm</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ein Blatt zum Anlegen ODER Bearbeiten – auf dem Handy von unten, am Desktop
 * mittig. Alle Felder an einem Ort, statt in der Liste zu suchen.
 */
function EmployeeSheet({
  employee,
  year,
  month,
  openDays,
  isClosed,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  year: number;
  month: number;
  openDays: number;
  isClosed: (iso: string) => boolean;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [urlaubOffen, setUrlaubOffen] = useState(false);
  const [loeschFrage, setLoeschFrage] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const weekly = Math.max(0, Math.round(Number(d.weekly) || 0));
  const monatH = Math.round((weekly * openDays) / 6);
  const info = splitInfo(monatH, d.employmentType);

  // Urlaub für die Anzeige aus dem ENTWURF berechnen (nicht aus dem Mitarbeiter).
  const draftEmp: Employee = { id: "draft", ...draftToEmployee(d) };
  const imJahr = vacationDaysInYear(draftEmp, year);
  const anspruch = vacationEntitlement(draftEmp);
  const imMonat = vacationDatesInMonth(draftEmp, year, month);
  const zuVielUrlaub = imJahr > anspruch;

  const toggleUrlaub = (iso: string) => {
    setD((prev) => {
      const jetzt = prev.vacationDates;
      return {
        ...prev,
        vacationDates: jetzt.includes(iso)
          ? jetzt.filter((x) => x !== iso)
          : [...jetzt, iso].sort(),
      };
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {employee ? "Sửa nhân viên" : "Thêm nhân viên"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-600">Tên</span>
            <input
              autoFocus={!employee}
              className={`${inputClass} w-full mt-1`}
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Tên nhân viên"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">Hình thức</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.employmentType}
                onChange={(e) => set("employmentType", e.target.value as EmploymentType)}
              >
                <option value="VOLLZEIT">{employmentLabelVi("VOLLZEIT")}</option>
                <option value="TEILZEIT">{employmentLabelVi("TEILZEIT")}</option>
                <option value="MINIJOB">{employmentLabelVi("MINIJOB")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Giờ / tuần</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className={`${inputClass} w-full mt-1`}
                value={d.weekly}
                onChange={(e) => set("weekly", e.target.value)}
              />
            </label>
          </div>
          <div className={`text-xs ${info.ok ? "text-slate-500" : "text-rose-600"}`}>
            Tháng này ≈ <b>{monatH}h</b> · {info.text}
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={d.fixed}
              onChange={(e) => set("fixed", e.target.checked)}
            />
            <span>
              Ca cố định <b>6:30–14:30</b>
              <span className="block text-xs text-slate-400">
                Chỉ làm đúng khung này (chuẩn bị sớm trước giờ mở cửa).
              </span>
            </span>
          </label>

          {/* Nghỉ phép */}
          <div className="border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setUrlaubOffen((v) => !v)}
                className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50"
              >
                Nghỉ phép {urlaubOffen ? "▲" : "▼"}
              </button>
              <span className={zuVielUrlaub ? "text-amber-700 font-medium" : "text-slate-500"}>
                {imJahr}/{anspruch} ngày trong năm {year}
                {zuVielUrlaub && " — vượt quy định"}
              </span>
              {imMonat.length > 0 && (
                <span className="text-slate-500">
                  · tháng này: {imMonat.map((x) => Number(x.slice(8))).join(", ")}
                </span>
              )}
            </div>
            {urlaubOffen && (
              <div className="mt-2">
                <VacationPicker
                  year={year}
                  month={month}
                  selected={d.vacationDates}
                  onToggle={toggleUrlaub}
                  isClosed={isClosed}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Tính theo <b>ngày làm việc</b> (§ 3 BUrlG). Vượt mức chỉ <b>cảnh báo</b>.
                  Cũng dùng để đánh dấu ngày <b>chưa vào làm</b> (VD vào giữa tháng).
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
          {loeschFrage ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Xoá nhân viên này?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLoeschFrage(false)}
                  className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Không
                </button>
                <button
                  onClick={onDelete}
                  className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
                >
                  Xoá
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {onDelete ? (
                <button
                  onClick={() => setLoeschFrage(true)}
                  className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                >
                  Xoá
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Huỷ
                </button>
                <button
                  onClick={() => onSave(draftToEmployee(d))}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Lưu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
