import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, Shift } from "../types";
import {
  vacationDatesInMonth,
  vacationDaysInYear,
  vacationEntitlement,
} from "../lib/availability";
import { VacationPicker } from "./VacationPicker";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_SHORT_VI,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToShortHours, minutesToTime } from "../lib/time";
import { signedHours } from "../lib/dateFormat";
import { monthLabel } from "../lib/shiftOps";
import { isDayClosed } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";
import { ShiftCellEditor } from "./ShiftCellEditor";
import { ScheduleDayView } from "./ScheduleDayView";
import { weeksOfMonth } from "../lib/weeks";
import { employmentShortVi } from "../lib/employment";
import { monthlyTargetMinutes } from "../lib/contract";

function isWeekendKey(iso: string): boolean {
  const k = weekdayKeyOf(parseIsoDate(iso));
  return k === "saturday" || k === "sunday";
}

function cellClass(shift: Shift | undefined): string {
  if (!shift) return "shift-free";
  const base = shift.shiftType === "EARLY" ? "shift-early" : "shift-late";
  return `${base} ${!shift.generated ? "shift-custom" : ""}`;
}

export function ScheduleTab({ store }: { store: UseScheduleReturn }) {
  // Drucken (Monat/Woche) und Entsperren liegen im Tab „Bảng chấm công" –
  // dort sitzt alles, was Papier erzeugt.
  const { schedule, validation, generate, genError, isLocked, updateEmployee, openDays } = store;
  // Trước khi tạo lịch: hỏi ai nghỉ phép tháng này (xem UrlaubDialog).
  const [urlaubOffen, setUrlaubOffen] = useState(false);
  const [selected, setSelected] = useState<{ employeeId: string; date: string } | null>(null);
  // Mặc định: điện thoại -> xem theo ngày, màn lớn -> bảng tháng.
  const [view, setView] = useState<"grid" | "day" | "week">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "day" : "grid",
  );
  const [weekIndex, setWeekIndex] = useState(0);

  const dates = useMemo(
    () => datesOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  /**
   * Tage, die im Raster gezeigt werden. In der Wochenansicht nur die der
   * gewählten Woche – gerechnet wird trotzdem immer mit dem ganzen Monat,
   * die Summen rechts bleiben also Monatssummen.
   */
  const gridDates = useMemo(() => {
    if (view !== "week") return dates;
    return weeks[Math.min(weekIndex, weeks.length - 1)]?.dates ?? dates;
  }, [view, weekIndex, weeks, dates]);

  // Tra nhanh: employeeId#date -> ALLE Dienste des Tages.
  //
  // Es kann zwei geben (mittags und abends). Vorher stand hier eine Map auf
  // EINEN Dienst, und der zweite verschwand lautlos aus der Anzeige – der Plan
  // sah dann anders aus, als er war.
  const shiftMap = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of schedule.shifts) {
      const key = `${s.employeeId}#${s.date}`;
      const liste = m.get(key);
      if (liste) liste.push(s);
      else m.set(key, [s]);
    }
    for (const liste of m.values()) liste.sort((a, b) => a.startMinutes - b.startMinutes);
    return m;
  }, [schedule.shifts]);

  const summaryByEmp = useMemo(
    () => new Map(validation.summaries.map((s) => [s.employee.id, s] as const)),
    [validation.summaries],
  );

  const overridesByDate = useMemo(
    () => new Map(schedule.dateOverrides.map((o) => [o.date, o] as const)),
    [schedule.dateOverrides],
  );

  // Geschlossene Tage (Sonntag + Feiertag-Overrides + Betriebsruhe) vorab.
  const closedByDate = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const ovMap = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
    const set = new Set<string>();
    for (const d of dates) {
      if (isDayClosed(schedule.workHours, d, holidays, ovMap)) set.add(d);
    }
    return set;
  }, [dates, schedule.workHours, schedule.year, schedule.dateOverrides]);

  // Tổng theo ngày cho các dòng chân bảng.
  const dayStats = useMemo(() => {
    const stats = new Map<string, { count: number; total: number; early: number; late: number }>();
    for (const d of dates) stats.set(d, { count: 0, total: 0, early: 0, late: 0 });
    for (const s of schedule.shifts) {
      const st = stats.get(s.date);
      if (!st) continue;
      st.count += 1;
      st.total += s.paidMinutes;
      if (s.shiftType === "EARLY") st.early += 1;
      else st.late += 1; // LATE hoặc CUSTOM tính là ca tối
    }
    return stats;
  }, [dates, schedule.shifts]);

  const hasEmployees = schedule.employees.length > 0;

  return (
    <section>
      {/* Alles Sichtbare liegt im no-print-Block; beim Drucken bleibt nur der
          Druckbereich ganz unten übrig. */}
      <div className="no-print">
      {urlaubOffen && (
        <UrlaubDialog
          employees={schedule.employees}
          year={schedule.year}
          month={schedule.month}
          updateEmployee={updateEmployee}
          isClosed={(iso) => closedByDate.has(iso)}
          onCancel={() => setUrlaubOffen(false)}
          onConfirm={() => {
            setUrlaubOffen(false);
            generate();
          }}
        />
      )}
      {/* Thanh thao tác */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => setUrlaubOffen(true)}
          disabled={!hasEmployees || isLocked}
          title={isLocked ? "Lịch tháng này đã khóa" : undefined}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          Tạo lịch làm việc
        </button>
        <span className="ml-auto text-sm text-slate-500">{monthLabel(schedule.year, schedule.month)}</span>
      </div>

      {/*
        Nur ein kurzer Hinweis - Drucken und Entsperren sitzen im Tab
        "Bang cham cong". Ohne diesen Hinweis klickt man hier auf eine Zelle
        und nichts passiert, ohne zu erfahren warum.
      */}
      {isLocked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khóa vì đã in
          {schedule.lockedAt && ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`} — chỉ
          xem, không sửa được. Muốn mở khóa thì sang tab <b>Bảng chấm công</b>.
        </div>
      )}

      {/* Chuyển chế độ xem */}
      {hasEmployees && (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-3">
          <button
            onClick={() => setView("day")}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "day" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Theo ngày
          </button>
          <button
            onClick={() => setView("week")}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "week" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Theo tuần
          </button>
          <button
            onClick={() => setView("grid")}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "grid" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Bảng tháng
          </button>
        </div>
      )}

      {/* Wochenwahl – nur in der Wochenansicht */}
      {hasEmployees && view === "week" && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {weeks.map((w, idx) => {
            const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
            return (
              <button
                key={w.weekStart}
                onClick={() => setWeekIndex(idx)}
                className={`rounded border px-3 py-1.5 text-sm ${
                  idx === weekIndex
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                title={printed ? "Tuần này đã in" : undefined}
              >
                {w.label}
                {printed && " ✓"}
              </button>
            );
          })}
          <span className="text-xs text-slate-500">In tuần ở tab „Bảng chấm công".</span>
        </div>
      )}

      {genError && (
        <div className="mb-3 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {genError}
        </div>
      )}

      {/* Lỗi kiểm tra */}
      {!validation.valid && schedule.shifts.length > 0 && (
        <div className="mb-3 rounded bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          <div className="font-medium mb-1">Lỗi kiểm tra ({validation.errors.length}):</div>
          <ul className="list-disc pl-5 space-y-0.5 max-h-40 overflow-auto">
            {validation.errors.slice(0, 30).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Chú thích (bảng tháng và bảng tuần dùng chung lưới) */}
      {view !== "day" && (
        <div className="flex flex-wrap gap-3 mb-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-early" /> Ca sáng
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-late" /> Ca tối
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-free" /> Nghỉ
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-custom bg-white" /> Đã sửa tay
          </span>
        </div>
      )}

      {!hasEmployees ? (
        <div className="rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
          Vui lòng thêm nhân viên trước.
        </div>
      ) : view === "day" ? (
        <ScheduleDayView store={store} onEdit={(employeeId, date) => setSelected({ employeeId, date })} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white -mx-3 sm:mx-0">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-2 py-2 text-left min-w-[130px]">
                  Nhân viên
                </th>
                <th className="bg-slate-100 border-b border-slate-200 px-2 py-2 text-left">Loại</th>
                <th className="bg-slate-100 border-b border-slate-200 px-2 py-2 text-right">Định mức</th>
                {gridDates.map((d) => {
                  const day = parseIsoDate(d).getDate();
                  const wk = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(d))];
                  const ov = overridesByDate.get(d);
                  const closed = closedByDate.has(d);
                  const headerBg = closed
                    ? "bg-rose-100"
                    : ov
                      ? "bg-sky-100"
                      : isWeekendKey(d)
                        ? "bg-slate-200"
                        : "bg-slate-100";
                  return (
                    <th
                      key={d}
                      title={
                        closed
                          ? `Đóng cửa${ov?.note ? " · " + ov.note : ""}`
                          : ov
                            ? `Giờ riêng${ov.note ? " · " + ov.note : ""}`
                            : undefined
                      }
                      className={`border-b border-l border-slate-200 px-1 py-1 text-center min-w-[88px] ${headerBg}`}
                    >
                      <div className="font-semibold">{day}</div>
                      <div className="text-[10px] text-slate-500">{wk}</div>
                      {closed && <div className="text-[9px] text-rose-600 font-medium">Đóng cửa</div>}
                      {!closed && ov && <div className="text-[9px] text-sky-700 font-medium">Giờ riêng</div>}
                    </th>
                  );
                })}
                <th className="bg-slate-100 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[64px]">
                  Đã xếp
                </th>
                <th className="bg-slate-100 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[70px]">
                  Chênh lệch
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.employees.map((emp) => {
                const sum = summaryByEmp.get(emp.id);
                const sollMin = monthlyTargetMinutes(emp, openDays);
                const diff = sum?.diffMinutes ?? -sollMin;
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
                      {emp.name}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1 text-slate-500">
                      {employmentShortVi(emp.employmentType)}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1 text-right text-slate-500">
                      {sollMin / 60}h
                    </td>
                    {gridDates.map((d) => {
                      const dienste = shiftMap.get(`${emp.id}#${d}`) ?? [];
                      const shift = dienste[0];
                      return (
                        <td
                          key={d}
                          onClick={() => setSelected({ employeeId: emp.id, date: d })}
                          className={`border-b border-l border-slate-200 px-1 py-1 text-center cursor-pointer align-middle ${cellClass(
                            shift,
                          )}`}
                          title="Bấm để sửa"
                        >
                          {shift ? (
                            <div className="leading-tight space-y-0.5">
                              {dienste.map((x) => (
                                <div key={x.id}>
                                  <div className="font-medium">
                                    {minutesToTime(x.startMinutes)}–{minutesToTime(x.endMinutes)}
                                  </div>
                                  <div className="text-[10px] opacity-80">
                                    {minutesToShortHours(x.paidMinutes)} · Nghỉ {x.pauseMinutes}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px]">Nghỉ</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-200 px-2 py-1 text-right font-medium">
                      {((sum?.assignedMinutes ?? 0) / 60).toLocaleString("de-DE", {
                        maximumFractionDigits: 2,
                      })}
                      h
                    </td>
                    <td
                      className={`border-b border-l border-slate-200 px-2 py-1 text-right font-medium ${
                        diff === 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {signedHours(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <SummaryRow label="Số nhân viên" dates={gridDates} value={(d) => String(dayStats.get(d)!.count)} />
              <SummaryRow
                label="Tổng giờ"
                dates={gridDates}
                value={(d) => minutesToShortHours(dayStats.get(d)!.total)}
              />
              <SummaryRow label="Ca sáng" dates={gridDates} value={(d) => String(dayStats.get(d)!.early)} />
              <SummaryRow label="Ca tối" dates={gridDates} value={(d) => String(dayStats.get(d)!.late)} />
            </tfoot>
          </table>
        </div>
      )}

      {/* Bearbeiten ist bei gesperrtem Monat gar nicht erst möglich. */}
      {selected && !isLocked && (
        <ShiftCellEditor
          store={store}
          employeeId={selected.employeeId}
          date={selected.date}
          onClose={() => setSelected(null)}
        />
      )}
      </div>
    </section>
  );
}

function SummaryRow({
  label,
  dates,
  value,
}: {
  label: string;
  dates: string[];
  value: (d: string) => string;
}) {
  return (
    <tr className="bg-slate-50 text-slate-600">
      <td className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
        {label}
      </td>
      <td className="border-t border-slate-200" />
      <td className="border-t border-slate-200" />
      {dates.map((d) => (
        <td key={d} className="border-t border-l border-slate-200 px-1 py-1 text-center">
          {value(d)}
        </td>
      ))}
      <td className="border-t border-l border-slate-200" />
      <td className="border-t border-l border-slate-200" />
    </tr>
  );
}

/**
 * Abfrage vor dem Erzeugen des Monatsplans: wer hat in diesem Monat Urlaub?
 *
 * Als Zwischenschritt gedacht: beim Klick auf "Tạo lịch làm việc" wird noch
 * einmal nach Urlaub gefragt, bevor der Plan entsteht. Der Automat sucht die
 * Tage NICHT selbst aus – wer wann frei nimmt, ist eine Absprache im Betrieb.
 * Hier wird nur eingesammelt, was schon feststeht, und sichtbar gemacht, wer
 * über seinen Jahresanspruch kommt.
 *
 * Dieselben Felder gibt es auch im Tab "Nhân viên". Das ist Absicht: dort
 * pflegt man die Belegschaft in Ruhe, hier wird man vor dem Planen noch einmal
 * daran erinnert, weil ein vergessener Urlaubstag erst auffällt, wenn der
 * fertige Plan schon hängt.
 */
function UrlaubDialog({
  employees,
  year,
  month,
  updateEmployee,
  isClosed,
  onCancel,
  onConfirm,
}: {
  employees: Employee[];
  year: number;
  month: number;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  isClosed: (iso: string) => boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const toggleUrlaub = (emp: Employee, iso: string) => {
    const jetzt = emp.vacationDates ?? [];
    updateEmployee(emp.id, {
      vacationDates: jetzt.includes(iso)
        ? jetzt.filter((d) => d !== iso)
        : [...jetzt, iso].sort(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl my-8">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">
            Ai nghỉ phép trong {monthLabel(year, month)}?
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Chọn ngày nghỉ trước khi tạo lịch. App <b>không tự chọn</b> ngày nghỉ — những
            ngày này sẽ được chừa ra khi xếp ca. Bỏ trống nếu không ai nghỉ.
          </p>
        </div>

        <div className="divide-y divide-slate-100 px-5">
          {employees.map((emp) => {
            const imMonat = vacationDatesInMonth(emp, year, month);
            const jahr = vacationDaysInYear(emp, year);
            const anspruch = vacationEntitlement(emp);
            const zuViel = jahr > anspruch;
            return (
              <div key={emp.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-slate-800">{emp.name}</span>
                  <span className="text-xs text-slate-400">
                    {employmentShortVi(emp.employmentType)}
                  </span>
                  <span
                    className={`text-xs ${zuViel ? "text-rose-600 font-medium" : "text-slate-400"}`}
                  >
                    {jahr}/{anspruch} ngày trong năm {year}
                    {zuViel && " ⚠ vượt quy định"}
                  </span>
                </div>
                <div className="mt-1.5">
                  <VacationPicker
                    year={year}
                    month={month}
                    selected={emp.vacationDates ?? []}
                    onToggle={(iso) => toggleUrlaub(emp, iso)}
                    isClosed={isClosed}
                  />
                  {imMonat.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500">
                      Đã chọn:{" "}
                      {imMonat.map((iso) => `${Number(iso.slice(8))}.${iso.slice(5, 7)}`).join(", ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Huỷ
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Tạo lịch
          </button>
        </div>
      </div>
    </div>
  );
}
