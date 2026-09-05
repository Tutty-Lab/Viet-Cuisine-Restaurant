import { useCallback, useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { splitTargetHours } from "../lib/splitTargetHours";
import { isDayClosed, resolveDay } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";
import { datesOfMonth } from "../lib/demand";
import { monthlyTargetMinutes } from "../lib/contract";
import {
  vacationDatesInMonth,
  vacationDaysInYear,
  vacationEntitlement,
} from "../lib/availability";
import { VacationPicker } from "./VacationPicker";

const inputClass =
  "rounded border border-slate-300 px-2 py-1 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

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

export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, addEmployee, updateEmployee, removeEmployee } = store;

  const holidays = useMemo(() => publicHolidays(schedule.year), [schedule.year]);
  const overrides = useMemo(
    () => Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o])),
    [schedule.dateOverrides],
  );
  const isClosed = useCallback(
    (iso: string) => isDayClosed(schedule.workHours, iso, holidays, overrides),
    [schedule.workHours, holidays, overrides],
  );

  // Offene Tage des Monats – Wochenstunden × offene Tage ÷ 6 = Monats-Soll.
  const openDays = useMemo(
    () =>
      datesOfMonth(schedule.year, schedule.month).filter(
        (d) => !resolveDay(schedule.workHours, d, holidays, overrides).closed,
      ).length,
    [schedule.year, schedule.month, schedule.workHours, holidays, overrides],
  );

  const [name, setName] = useState("");
  const [type, setType] = useState<EmploymentType>("VOLLZEIT");
  const [weekly, setWeekly] = useState(39);

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900 mb-1">Nhân viên</h2>
      <p className="text-xs text-slate-500 mb-4">
        Giờ nhập theo <b>tuần</b>. Định mức tháng = giờ/tuần × số ngày mở trong tháng ÷ 6 (quán
        mở 6 ngày/tuần, nghỉ thứ 2). Tháng này có <b>{openDays}</b> ngày mở.
      </p>

      {/* Thêm nhân viên mới */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 mb-5 rounded bg-slate-50 border border-slate-200 p-3">
        <label className="flex flex-col sm:flex-1 sm:min-w-[140px]">
          <span className="text-xs text-slate-600 mb-1">Tên</span>
          <input
            className={`${inputClass} w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên nhân viên"
          />
        </label>
        <label className="flex flex-col sm:w-40">
          <span className="text-xs text-slate-600 mb-1">Hình thức làm việc</span>
          <select
            className={`${inputClass} w-full`}
            value={type}
            onChange={(e) => setType(e.target.value as EmploymentType)}
          >
            <option value="VOLLZEIT">Toàn thời gian</option>
            <option value="TEILZEIT">Bán thời gian</option>
            <option value="MINIJOB">Minijob</option>
          </select>
        </label>
        <label className="flex flex-col sm:w-28">
          <span className="text-xs text-slate-600 mb-1">Giờ / tuần</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className={`${inputClass} w-full`}
            value={weekly}
            onChange={(e) => setWeekly(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() => {
            addEmployee(name, type, weekly);
            setName("");
          }}
          className="rounded bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800"
        >
          Thêm nhân viên
        </button>
      </div>

      {schedule.employees.length === 0 ? (
        <div className="py-6 text-center text-slate-400">
          Chưa có nhân viên. Thêm nhân viên ở khung phía trên.
        </div>
      ) : (
        <div className="space-y-2">
          {schedule.employees.map((emp) => {
            const monatH = monthlyTargetMinutes(emp, openDays) / 60;
            const info = splitInfo(monatH, emp.employmentType);
            const fixed = !!emp.fixedShift;
            return (
              <div key={emp.id} className="rounded-lg border border-slate-200 p-3 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <label className="flex flex-col sm:flex-1">
                    <span className="text-xs text-slate-500 mb-1 sm:hidden">Tên</span>
                    <input
                      className={`${inputClass} w-full`}
                      value={emp.name}
                      onChange={(e) => updateEmployee(emp.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col sm:w-40">
                    <span className="text-xs text-slate-500 mb-1 sm:hidden">Hình thức</span>
                    <select
                      className={`${inputClass} w-full`}
                      value={emp.employmentType}
                      onChange={(e) =>
                        updateEmployee(emp.id, {
                          employmentType: e.target.value as EmploymentType,
                        })
                      }
                    >
                      <option value="VOLLZEIT">Toàn thời gian</option>
                      <option value="TEILZEIT">Bán thời gian</option>
                      <option value="MINIJOB">Minijob</option>
                    </select>
                  </label>
                  <label className="flex flex-col sm:w-28">
                    <span className="text-xs text-slate-500 mb-1 sm:hidden">Giờ / tuần</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        className={`${inputClass} w-full`}
                        value={emp.weeklyHours ?? ""}
                        onChange={(e) =>
                          updateEmployee(emp.id, {
                            weeklyHours:
                              e.target.value === ""
                                ? undefined
                                : Math.max(0, Math.round(Number(e.target.value))),
                          })
                        }
                      />
                      <span className="text-slate-400 text-xs">h/tuần</span>
                    </div>
                  </label>
                  <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-end gap-1 sm:w-28">
                    <span className={`text-xs ${info.ok ? "text-slate-500" : "text-rose-600"}`}>
                      {monatH > 0 ? `${monatH}h · ${info.text}` : info.text}
                    </span>
                    <button
                      onClick={() => removeEmployee(emp.id)}
                      className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                    >
                      Xoá
                    </button>
                  </div>
                </div>

                {/*
                  Feste Frühschicht 6:30–14:30: diese Person arbeitet immer in
                  genau diesem Fenster (Vorbereitung ab vor Ladenöffnung).
                */}
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fixed}
                    onChange={(e) =>
                      updateEmployee(emp.id, {
                        fixedShift: e.target.checked
                          ? { startMinutes: FIXED_START, endMinutes: FIXED_END }
                          : undefined,
                      })
                    }
                  />
                  <span>
                    Ca cố định <b>6:30–14:30</b> (chuẩn bị sớm; app luôn xếp đúng khung này)
                  </span>
                </label>

                <Urlaub
                  emp={emp}
                  year={schedule.year}
                  month={schedule.month}
                  updateEmployee={updateEmployee}
                  isClosed={isClosed}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Urlaub einer Person: die Tage stehen fest im Betrieb, die App verteilt sie
 * nicht selbst. Eingetragene Tage werden beim Planen ausgespart.
 */
function Urlaub({
  emp,
  year,
  month,
  updateEmployee,
  isClosed,
}: {
  emp: Employee;
  year: number;
  month: number;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  isClosed: (iso: string) => boolean;
}) {
  const [offen, setOffen] = useState(false);

  const imJahr = vacationDaysInYear(emp, year);
  const anspruch = vacationEntitlement(emp);
  const imMonat = vacationDatesInMonth(emp, year, month);
  const zuViel = imJahr > anspruch;

  const toggle = (iso: string) => {
    const jetzt = emp.vacationDates ?? [];
    updateEmployee(emp.id, {
      vacationDates: jetzt.includes(iso)
        ? jetzt.filter((d) => d !== iso)
        : [...jetzt, iso].sort(),
    });
  };

  return (
    <div className="border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setOffen((v) => !v)}
          className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50"
        >
          Nghỉ phép {offen ? "▲" : "▼"}
        </button>
        <span className={zuViel ? "text-amber-700 font-medium" : "text-slate-500"}>
          {imJahr}/{anspruch} ngày trong năm {year}
          {zuViel && " — vượt quy định"}
        </span>
        {imMonat.length > 0 && (
          <span className="text-slate-500">
            · tháng này: {imMonat.map((d) => Number(d.slice(8))).join(", ")}
          </span>
        )}
      </div>

      {offen && (
        <div className="mt-2">
          <VacationPicker
            year={year}
            month={month}
            selected={emp.vacationDates ?? []}
            onToggle={toggle}
            isClosed={isClosed}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Tính theo <b>ngày làm việc</b> (§ 3 BUrlG): đi làm 1 tiếng cũng hết một ngày phép.
            Vượt quy định thì chỉ <b>cảnh báo</b>, vẫn tạo được lịch.
          </p>
        </div>
      )}
    </div>
  );
}
