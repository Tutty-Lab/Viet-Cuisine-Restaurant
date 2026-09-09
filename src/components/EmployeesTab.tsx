import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { splitTargetHours } from "../lib/splitTargetHours";
import { WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import { monthlyTargetMinutes } from "../lib/contract";
import { employmentLabelVi, employmentShortVi } from "../lib/employment";
import { minutesToTime, timeToMinutes } from "../lib/time";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/** Voreinstellung der festen Schicht, wenn eingeschaltet: 6:30–14:30. */
const FIXED_START_DEFAULT = "06:30";
const FIXED_END_DEFAULT = "14:30";

const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

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
  fixedStart: string; // "HH:MM"
  fixedEnd: string; // "HH:MM"
  availableWeekdays: WeekdayKey[]; // [] = mọi ngày
  maxDays: string;
};

function draftFrom(emp?: Employee): Draft {
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    weekly: emp?.weeklyHours != null ? String(emp.weeklyHours) : "39",
    fixed: !!emp?.fixedShift,
    // Vorhandene feste Schicht übernehmen, sonst die Voreinstellung anzeigen.
    fixedStart: emp?.fixedShift ? minutesToTime(emp.fixedShift.startMinutes) : FIXED_START_DEFAULT,
    fixedEnd: emp?.fixedShift ? minutesToTime(emp.fixedShift.endMinutes) : FIXED_END_DEFAULT,
    availableWeekdays: emp?.availableWeekdays ?? [],
    maxDays: emp?.maxDaysPerWeek ? String(emp.maxDaysPerWeek) : "",
  };
}

/** Wandelt "HH:MM" in Minuten; bei Unsinn die Voreinstellung. */
function safeMinutes(time: string, fallback: string): number {
  try {
    return timeToMinutes(time);
  } catch {
    return timeToMinutes(fallback);
  }
}

/** Entwurf -> Mitarbeiter-Felder (ohne id). */
function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const weekly = Math.max(0, Math.round(Number(d.weekly) || 0));
  const tage = Number(d.maxDays);
  const fixedStart = safeMinutes(d.fixedStart, FIXED_START_DEFAULT);
  const fixedEnd = safeMinutes(d.fixedEnd, FIXED_END_DEFAULT);
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    targetMinutes: 0, // wird je Monat aus weeklyHours abgeleitet (contract.ts)
    weeklyHours: weekly,
    // Ende muss nach Beginn liegen – sonst die feste Schicht ignorieren, statt
    // eine kaputte Zeitspanne zu speichern.
    fixedShift:
      d.fixed && fixedEnd > fixedStart
        ? { startMinutes: fixedStart, endMinutes: fixedEnd }
        : undefined,
    availableWeekdays:
      d.availableWeekdays.length === 0 || d.availableWeekdays.length === 7
        ? undefined
        : [...d.availableWeekdays],
    maxDaysPerWeek: d.maxDays === "" || tage < 1 ? undefined : Math.min(7, Math.round(tage)),
  };
}

export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, openDays, addEmployee, updateEmployee, removeEmployee } = store;
  const locked = Boolean(schedule.lockedAt);

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
        Giờ nhập theo <b>tuần</b>. Tuần đủ 6 ngày giữ đúng giờ hợp đồng; tuần đầu/cuối tháng tính theo ngày.
        Tháng này tính định mức trên <b>{openDays}</b> ngày, tối đa 6 ngày mỗi tuần. Bấm vào một người để sửa.
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
                <EmployeeSummaryRow emp={emp} openDays={openDays} />
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
          openDays={openDays}
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
}: {
  emp: Employee;
  openDays: number;
}) {
  const monatH = monthlyTargetMinutes(emp, openDays) / 60;
  const info = splitInfo(monatH, emp.employmentType);

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
            ca cố định {minutesToTime(emp.fixedShift.startMinutes)}–
            {minutesToTime(emp.fixedShift.endMinutes)}
          </span>
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
  openDays,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  openDays: number;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [loeschFrage, setLoeschFrage] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const monatH = monthlyTargetMinutes({ ...draftToEmployee(d), id: employee?.id ?? "preview" }, openDays) / 60;
  const info = splitInfo(monatH, d.employmentType);

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

          <div>
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={d.fixed}
                onChange={(e) => set("fixed", e.target.checked)}
              />
              <span>
                Ca cố định
                <span className="block text-xs text-slate-400">
                  Chỉ làm đúng khung giờ này (đặt giờ tuỳ ý bên dưới).
                </span>
              </span>
            </label>

            {d.fixed && (
              <div className="mt-2 ml-6 flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span className="text-xs text-slate-500">Khung giờ</span>
                <input
                  type="time"
                  className={inputClass}
                  value={d.fixedStart}
                  onChange={(e) => set("fixedStart", e.target.value)}
                />
                <span className="text-slate-400">–</span>
                <input
                  type="time"
                  className={inputClass}
                  value={d.fixedEnd}
                  onChange={(e) => set("fixedEnd", e.target.value)}
                />
                {safeMinutes(d.fixedEnd, FIXED_END_DEFAULT) <=
                  safeMinutes(d.fixedStart, FIXED_START_DEFAULT) && (
                  <span className="text-xs text-rose-600">Giờ kết thúc phải sau giờ bắt đầu.</span>
                )}
              </div>
            )}
          </div>

          {/* Ngày làm trong tuần + số ngày/tuần. */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs text-slate-600 mb-1.5">
              Ngày làm trong tuần
              {d.availableWeekdays.length === 0 && (
                <span className="text-slate-400"> — bỏ trống = làm mọi ngày</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_ORDER.map((key) => {
                const alle = d.availableWeekdays.length === 0;
                const an = alle || d.availableWeekdays.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      const basis = alle ? WEEKDAY_ORDER : d.availableWeekdays;
                      const naechste = basis.includes(key)
                        ? basis.filter((k) => k !== key)
                        : [...basis, key];
                      set("availableWeekdays", naechste);
                    }}
                    className={`rounded px-2 py-1 text-xs border transition-colors ${
                      an
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-400 border-slate-200 line-through"
                    }`}
                  >
                    {WEEKDAY_SHORT_VI[key]}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
              Số ngày làm mỗi tuần
              <input
                type="number"
                min={1}
                max={7}
                placeholder="—"
                className={`${inputClass} w-16`}
                value={d.maxDays}
                onChange={(e) => set("maxDays", e.target.value)}
              />
              <span className="text-slate-400">bỏ trống = không giới hạn</span>
            </label>
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
