import { useEffect, useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Shift } from "../types";
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
import { monthlyTargetMinutesFor, SCHEDULE_SLOT_MINUTES } from "../lib/contract";
import { StaffingReport } from "./StaffingReport";
import { PauseLabel } from "./PauseLabel";
import { CoverageChart } from "./CoverageChart";

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
  const { schedule, validation, generate, genError, genStamp, isLocked, openDates } = store;
  const [selected, setSelected] = useState<{ employeeId: string; date: string } | null>(null);
  // Zweiter Klick, um einen gesperrten (gedruckten) Monat neu zu erzeugen –
  // ohne native Rückfrage, die manche In-App-Browser verschlucken.
  const [confirmRegen, setConfirmRegen] = useState(false);
  // Kurze Erfolgsmeldung nach dem Erzeugen. genStamp steigt bei jedem
  // erfolgreichen Lauf; der Effekt liest DANACH die (frische) Prüfung aus.
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (genStamp === 0) return;
    const fehler = validation.errors.filter((e) => e.severity !== "warning").length;
    const warn = validation.errors.filter((e) => e.severity === "warning").length;
    setToast(
      fehler > 0
        ? `Đã tạo lịch — nhưng còn ${fehler} lỗi, xem chi tiết ở phần trạng thái.`
        : warn > 0
          ? `✓ Đã tạo lịch mới (còn ${warn} cảnh báo thiếu giờ — bấm (i) để xem).`
          : "✓ Đã tạo lịch mới — hợp lệ, giờ chia đều cho mọi người.",
    );
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [genStamp]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mặc định: điện thoại -> xem theo ngày, màn lớn -> bảng tháng.
  const [view, setView] = useState<"grid" | "day" | "week" | "coverage">(() =>
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
      {/* Thanh thao tác */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => {
            // Gesperrter Monat: erst nachfragen, dann neu erzeugen (die
            // Erzeugung hebt die Sperre auf und löscht die Wochen-Häkchen).
            if (isLocked && !confirmRegen) {
              setConfirmRegen(true);
              return;
            }
            generate();
            setConfirmRegen(false);
          }}
          disabled={!hasEmployees}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          Tạo lịch làm việc
        </button>
        {confirmRegen && (
          <button
            onClick={() => setConfirmRegen(false)}
            className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Huỷ
          </button>
        )}
        <span className="ml-auto text-sm text-slate-500">{monthLabel(schedule.year, schedule.month)}</span>
      </div>

      {/* Erfolgsmeldung nach „Tạo lịch". Verschwindet nach ein paar Sekunden;
          Details zu Warnungen/Fehlern stehen aufklappbar oben im Dashboard. */}
      {toast && (
        <div
          role="status"
          className={`mb-3 flex items-start gap-2 rounded border px-3 py-2 text-sm ${
            toast.startsWith("✓")
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-amber-50 border-amber-200 text-amber-900"
          }`}
        >
          <span className="flex-1">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 opacity-60 hover:opacity-100"
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
      )}

      {/* Rückfrage vor dem Neu-Erzeugen eines gedruckten Monats. */}
      {isLocked && confirmRegen && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-300 text-amber-900 text-sm px-3 py-2">
          Tháng này đã in &amp; khóa. <b>Tạo lại lịch sẽ mở khóa tháng và xóa dấu các tuần đã in</b> —
          bản đã treo ở quán sẽ không còn khớp. Bấm lại <b>„Tạo lịch làm việc"</b> để tiếp tục.
        </div>
      )}

      {/*
        Nur ein kurzer Hinweis - Drucken und Entsperren sitzen im Tab
        "Bang cham cong". Ohne diesen Hinweis klickt man hier auf eine Zelle
        und nichts passiert, ohne zu erfahren warum.
      */}
      {isLocked && !confirmRegen && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khóa vì đã in
          {schedule.lockedAt && ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`} — chỉ
          xem, không sửa được. Mở khóa ở tab <b>Bảng chấm công</b>, hoặc bấm{" "}
          <b>„Tạo lịch làm việc"</b> để tạo lại (sẽ mở khóa).
        </div>
      )}

      {/* Chuyển chế độ xem */}
      {hasEmployees && (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-3">
          <button
            onClick={() => setView("day")}
            aria-pressed={view === "day"}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "day" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Theo ngày
          </button>
          <button
            onClick={() => setView("week")}
            aria-pressed={view === "week"}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "week" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Theo tuần
          </button>
          <button
            onClick={() => setView("grid")}
            aria-pressed={view === "grid"}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "grid" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Bảng tháng
          </button>
          <button
            onClick={() => setView("coverage")}
            aria-pressed={view === "coverage"}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "coverage" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Độ phủ
          </button>
        </div>
      )}

      {/* Wochenwahl für Dienstplan und Besetzungsdiagramm. */}
      {hasEmployees && (view === "week" || view === "coverage") && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {weeks.map((w, idx) => {
            const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
            return (
              <button
                key={w.weekStart}
                onClick={() => setWeekIndex(idx)}
                aria-pressed={idx === weekIndex}
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
          {view === "week" && <span className="text-xs text-slate-500">In tuần ở tab „Bảng chấm công".</span>}
        </div>
      )}

      {schedule.shifts.length > 0 && <StaffingReport analysis={store.analysis} />}

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
      {(view === "grid" || view === "week") && (
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
      ) : view === "coverage" ? (
        <CoverageChart schedule={schedule} dates={weeks[Math.min(weekIndex, weeks.length - 1)]?.dates ?? dates} />
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
                const sollMin = monthlyTargetMinutesFor(emp, openDates);
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
                      {minutesToShortHours(sollMin)}
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
                            <div className="leading-tight space-y-1">
                              {dienste.map((x, idx) => {
                                const isMulti = dienste.length > 1;
                                const shiftTag = isMulti
                                  ? idx === 0
                                    ? "Ca sáng"
                                    : idx === 1
                                      ? "Ca chiều"
                                      : `Ca ${idx + 1}`
                                  : null;
                                return (
                                  <div
                                    key={x.id}
                                    className={idx > 0 ? "border-t border-slate-200/90 pt-1 mt-0.5" : ""}
                                  >
                                    <div className="font-medium flex items-center justify-center gap-1">
                                      {shiftTag && (
                                        <span className="inline-block text-[9px] font-semibold text-slate-600 bg-slate-100/90 border border-slate-300/80 rounded px-1">
                                          {shiftTag}
                                        </span>
                                      )}
                                      <span>
                                        {minutesToTime(x.startMinutes)}–{minutesToTime(x.endMinutes)}
                                      </span>
                                    </div>
                                    <div className="text-[10px] opacity-80">
                                      {minutesToShortHours(x.paidMinutes)} · <PauseLabel shift={x} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-[11px]">Nghỉ</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-200 px-2 py-1 text-right font-medium">
                      {minutesToShortHours(sum?.assignedMinutes ?? 0)}
                    </td>
                    <td
                      className={`border-b border-l border-slate-200 px-2 py-1 text-right font-medium ${
                        Math.abs(diff) <= SCHEDULE_SLOT_MINUTES / 2 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {Math.abs(diff) <= SCHEDULE_SLOT_MINUTES / 2 ? "≈0,0" : signedHours(diff)}
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
