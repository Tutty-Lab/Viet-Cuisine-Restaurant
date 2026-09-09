import { useMemo } from "react";
import type { Schedule, Shift } from "../types";
import { WEEKDAY_SHORT_VI } from "../lib/demand";
import { publicHolidays } from "../lib/holidays";
import { coveragePoints, staffingWindows, workingAt } from "../lib/staffing";
import { effectiveWeekdayKey, resolveDay } from "../lib/workHours";
import { minutesToTime } from "../lib/time";

type Slot = {
  from: number;
  to: number;
  actual: number;
  required: number;
  allowed: number;
  closed: boolean;
  band: "normal" | "operation" | "rush" | "closing";
};

const SLOT = 30;

function minWorking(shifts: Shift[], from: number, to: number): number {
  const points = coveragePoints(shifts, from, to).slice(0, -1);
  return points.length
    ? Math.min(...points.map((minute) => new Set(shifts.filter((shift) => workingAt(shift, minute)).map((shift) => shift.employeeId)).size))
    : 0;
}

function bandOf(labels: string[]): Slot["band"] {
  if (labels.includes("Đóng cửa")) return "closing";
  if (labels.some((label) => label === "Tối" || label === "Trưa CN")) return "rush";
  if (labels.length) return "operation";
  return "normal";
}

function slotBackground(slot: Slot): string {
  if (slot.closed) return "bg-slate-100 text-slate-400";
  if (slot.band === "closing") return "bg-sky-50";
  if (slot.band === "rush") return "bg-amber-50";
  if (slot.band === "operation") return "bg-emerald-50/60";
  return "bg-white";
}

export function CoverageChart({ schedule, dates }: { schedule: Schedule; dates: string[] }) {
  const rows = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    const overrides = Object.fromEntries(schedule.dateOverrides.map((override) => [override.date, override]));
    return dates.map((date) => {
      const day = resolveDay(schedule.workHours, date, holidays, overrides);
      if (day.closed) return { date, slots: [] as Slot[] };
      const shifts = schedule.shifts.filter((shift) => shift.date === date);
      const windows = staffingWindows(day.blocks, effectiveWeekdayKey(date, holidays));
      const slots: Slot[] = [];
      for (let from = day.window.startMinutes; from < day.window.endMinutes; from += SLOT) {
        const to = Math.min(from + SLOT, day.window.endMinutes);
        const isOpen = day.blocks.some((block) => from >= block.startMinutes && to <= block.endMinutes);
        const active = windows.filter((window) => window.startMinutes < to && window.endMinutes > from);
        const finiteAllowed = active.map((window) => window.maxStaff).filter(Number.isFinite);
        slots.push({
          from,
          to,
          actual: isOpen ? minWorking(shifts, from, to) : 0,
          required: isOpen && active.length ? Math.max(...active.map((window) => window.minStaff)) : 0,
          allowed: finiteAllowed.length ? Math.min(...finiteAllowed) : Infinity,
          closed: !isOpen,
          band: bandOf(active.map((window) => window.label)),
        });
      }
      return { date, slots };
    });
  }, [dates, schedule]);

  const scale = Math.max(6, ...rows.flatMap((row) => row.slots.flatMap((slot) => [slot.actual, slot.required])));

  if (schedule.shifts.length === 0) {
    return <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Tạo lịch trước để xem độ phủ.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Mỗi cột = 30 phút</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 bg-teal-600" /> Số đang làm</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-amber-600" /> Mức yêu cầu</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Cao điểm</span>
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">Cuối ca</span>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">Mức tối thiểu</span>
      </div>

      {rows.map(({ date, slots }) => {
        const weekday = WEEKDAY_SHORT_VI[effectiveWeekdayKey(date, publicHolidays(schedule.year))];
        return (
          <section key={date} className="rounded-lg border border-slate-200 bg-white shadow-sm" aria-label={`Độ phủ ${date}`}>
            <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <h3 className="text-sm font-semibold text-slate-900">{date.split("-").reverse().join(".")} · {weekday}</h3>
              {slots.length > 0 && <span className="text-xs text-slate-500">Thực tế / yêu cầu</span>}
            </header>
            {slots.length === 0 ? (
              <div className="px-3 py-5 text-center text-sm text-slate-400">Đóng cửa</div>
            ) : (
              <div className="overflow-x-auto px-2 pb-2">
                <div className="flex min-w-max pt-2" role="list" aria-label={`Số người làm theo từng 30 phút ngày ${date}`}>
                  {slots.map((slot) => {
                    const shortfall = slot.required > 0 && slot.actual < slot.required;
                    const excess = Number.isFinite(slot.allowed) && slot.actual > slot.allowed;
                    const requirement = slot.required > 0
                      ? `${slot.required}${Number.isFinite(slot.allowed) ? `–${slot.allowed}` : "+"}`
                      : "—";
                    return (
                      <div
                        key={slot.from}
                        className={`w-11 shrink-0 border-r border-slate-100 text-center ${slotBackground(slot)} ${shortfall || excess ? "ring-1 ring-inset ring-rose-400" : ""}`}
                        title={`${minutesToTime(slot.from)}–${minutesToTime(slot.to)}: ${slot.closed ? "đóng cửa" : `${slot.actual} người, yêu cầu ${requirement}`}`}
                        aria-label={`${minutesToTime(slot.from)}: ${slot.closed ? "đóng cửa" : `${slot.actual} người, yêu cầu ${requirement}`}`}
                        role="listitem"
                      >
                        <div className="h-4 text-[9px] font-medium text-slate-500">{slot.band === "rush" ? "CĐ" : slot.band === "closing" ? "Cuối" : slot.band === "operation" ? "Mức" : ""}</div>
                        <div className="relative mx-1 h-20 border-b border-slate-300">
                          {!slot.closed && slot.required > 0 && (
                            <span className="absolute inset-x-0 z-10 border-t-2 border-dashed border-amber-600" style={{ bottom: `${slot.required / scale * 100}%` }} />
                          )}
                          {!slot.closed && (
                            <span className="absolute inset-x-1 bottom-0 bg-teal-600" style={{ height: `${slot.actual / scale * 100}%` }} />
                          )}
                          {!slot.closed && <span className="absolute inset-x-0 z-20 text-xs font-bold text-slate-900" style={{ bottom: `${Math.min(88, slot.actual / scale * 100 + 2)}%` }}>{slot.actual}</span>}
                          {slot.closed && <span className="absolute inset-0 flex items-center justify-center text-[9px]">Đóng</span>}
                        </div>
                        <div className="pt-1 text-[9px] font-medium text-slate-600">{minutesToTime(slot.from)}</div>
                        <div className={`pb-1 text-[9px] ${shortfall || excess ? "font-bold text-rose-700" : "text-slate-500"}`}>cần {slot.closed ? "—" : requirement}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
