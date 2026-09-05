import { useMemo, useRef, useState, useEffect } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_VI,
  WEEKDAY_SHORT_VI,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToShortHours, minutesToTime } from "../lib/time";
import { isoLabel } from "../lib/shiftOps";
import { publicHolidayNames, publicHolidays } from "../lib/holidays";
import { isDayClosed } from "../lib/workHours";
import { format } from "date-fns";
import { employmentLabelVi } from "../lib/employment";

/** Chế độ xem theo từng ngày – tối ưu cho điện thoại (không cuộn ngang). */
export function ScheduleDayView({
  store,
  onEdit,
}: {
  store: UseScheduleReturn;
  onEdit: (employeeId: string, date: string) => void;
}) {
  const { schedule } = store;
  const dates = useMemo(
    () => datesOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  const holidayNames = useMemo(() => publicHolidayNames(schedule.year), [schedule.year]);
  const overridesByDate = useMemo(
    () => new Map(schedule.dateOverrides.map((o) => [o.date, o] as const)),
    [schedule.dateOverrides],
  );
  const closedByDate = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const ovMap = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
    const set = new Set<string>();
    for (const d of dates) if (isDayClosed(schedule.workHours, d, holidays, ovMap)) set.add(d);
    return set;
  }, [dates, schedule.workHours, schedule.year, schedule.dateOverrides]);

  const today = format(new Date(), "yyyy-MM-dd");
  const [selected, setSelected] = useState<string>(() =>
    dates.includes(today) ? today : dates[0],
  );
  // Nếu đổi tháng/năm mà ngày chọn không còn trong danh sách -> về ngày đầu.
  useEffect(() => {
    if (!dates.includes(selected)) setSelected(dates[0]);
  }, [dates, selected]);

  // Tự cuộn chip ngày đang chọn vào tầm nhìn.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-date="${selected}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selected]);

  const shiftsOfDay = useMemo(
    () => schedule.shifts.filter((s) => s.date === selected),
    [schedule.shifts, selected],
  );
  const shiftByEmp = useMemo(
    () => new Map(shiftsOfDay.map((s) => [s.employeeId, s] as const)),
    [shiftsOfDay],
  );

  const working = schedule.employees.filter((e) => shiftByEmp.has(e.id));
  const free = schedule.employees.filter((e) => !shiftByEmp.has(e.id));

  const totalMin = shiftsOfDay.reduce((a, s) => a + s.paidMinutes, 0);
  const earlyCount = shiftsOfDay.filter((s) => s.shiftType === "EARLY").length;
  const lateCount = shiftsOfDay.length - earlyCount;

  const ov = overridesByDate.get(selected);
  const holiday = holidayNames.get(selected);
  const weekdayKey = weekdayKeyOf(parseIsoDate(selected));
  const isWeekend = weekdayKey === "saturday" || weekdayKey === "sunday";

  function chipClass(iso: string): string {
    const o = overridesByDate.get(iso);
    const isSel = iso === selected;
    if (isSel) return "bg-slate-900 text-white border-slate-900";
    if (closedByDate.has(iso)) return "bg-rose-50 text-rose-700 border-rose-200";
    if (o) return "bg-sky-50 text-sky-700 border-sky-200";
    const k = weekdayKeyOf(parseIsoDate(iso));
    if (k === "saturday" || k === "sunday") return "bg-slate-100 text-slate-700 border-slate-200";
    return "bg-white text-slate-600 border-slate-200";
  }

  return (
    <div>
      {/* Dải chọn ngày */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0">
        {dates.map((iso) => {
          const d = parseIsoDate(iso).getDate();
          const wk = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(iso))];
          return (
            <button
              key={iso}
              data-date={iso}
              onClick={() => setSelected(iso)}
              className={`shrink-0 w-12 rounded-lg border py-1.5 text-center ${chipClass(iso)}`}
            >
              <div className="text-sm font-semibold leading-tight">{d}</div>
              <div className="text-[10px] leading-tight opacity-80">{wk}</div>
            </button>
          );
        })}
      </div>

      {/* Đầu ngày + badge */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          {WEEKDAY_LABELS_VI[weekdayKey]}, {isoLabel(selected)}
        </h3>
        {closedByDate.has(selected) && (
          <span className="rounded-full bg-rose-100 text-rose-700 text-xs px-2 py-0.5 font-medium">
            Đóng cửa
          </span>
        )}
        {ov && !ov.closed && (
          <span className="rounded-full bg-sky-100 text-sky-700 text-xs px-2 py-0.5 font-medium">
            Giờ riêng {minutesToTime(ov.window!.startMinutes)}–{minutesToTime(ov.window!.endMinutes)}
          </span>
        )}
        {holiday && (
          <span className="rounded-full bg-amber-100 text-amber-800 text-xs px-2 py-0.5 font-medium">
            Lễ: {holiday}
          </span>
        )}
        {!ov && !holiday && isWeekend && (
          <span className="rounded-full bg-slate-100 text-slate-600 text-xs px-2 py-0.5">Cuối tuần</span>
        )}
      </div>

      {/* Tóm tắt ngày */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Summary label="Số NV" value={String(working.length)} />
        <Summary label="Tổng giờ" value={minutesToShortHours(totalMin)} />
        <Summary label="Sáng / Tối" value={`${earlyCount} / ${lateCount}`} />
      </div>

      {/* Danh sách người làm */}
      <div className="mt-3 space-y-2">
        {working.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-400">
            {schedule.shifts.length === 0 ? "Chưa tạo lịch." : "Không ai làm ngày này."}
          </div>
        ) : (
          working.map((emp) => {
            const s = shiftByEmp.get(emp.id) as Shift;
            const isEarly = s.shiftType === "EARLY";
            return (
              <button
                key={emp.id}
                onClick={() => onEdit(emp.id, selected)}
                className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left ${
                  isEarly ? "shift-early" : "shift-late"
                } ${!s.generated ? "shift-custom" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{emp.name}</div>
                  <div className="text-xs opacity-80">
                    {employmentLabelVi(emp.employmentType)} ·{" "}
                    {isEarly ? "Ca sáng" : "Ca tối"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold">
                    {minutesToTime(s.startMinutes)}–{minutesToTime(s.endMinutes)}
                  </div>
                  <div className="text-xs opacity-80">
                    {minutesToShortHours(s.paidMinutes)} · Nghỉ {s.pauseMinutes}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Người đang nghỉ – bấm để thêm ca */}
      {free.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-slate-500 mb-1">Đang nghỉ ({free.length}) — bấm để thêm ca:</div>
          <div className="flex flex-wrap gap-1.5">
            {free.map((emp) => (
              <button
                key={emp.id}
                onClick={() => onEdit(emp.id, selected)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-600 hover:border-slate-300"
              >
                {emp.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
      <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
      <div className="text-base font-semibold text-slate-900 leading-tight">{value}</div>
    </div>
  );
}
