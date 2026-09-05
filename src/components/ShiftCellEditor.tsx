import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { calculatePause, minutesToShortHours, minutesToTime, timeToMinutes } from "../lib/time";
import { isoLabel } from "../lib/shiftOps";
import { WEEKDAY_LABELS_VI, weekdayKeyOf, parseIsoDate } from "../lib/demand";
import { frameOf, resolveDay } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

export function ShiftCellEditor({
  store,
  employeeId,
  date,
  onClose,
}: {
  store: UseScheduleReturn;
  employeeId: string;
  date: string;
  onClose: () => void;
}) {
  const { schedule, findShift, editShiftTimes, addShift, deleteShift, setFrei, moveShiftToEmployee } =
    store;
  const employee = schedule.employees.find((e) => e.id === employeeId)!;
  const shift = findShift(employeeId, date);

  // Standardzeiten für eine neue Schicht = Arbeitszeit-Fenster dieses Tages
  // (inkl. Ausnahmen / Feiertag).
  const overrideMap = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  const resolved = resolveDay(schedule.workHours, date, publicHolidays(schedule.year), overrideMap);
  // Bei geschlossenem Tag als Vorschlag den Feiertagsrahmen nehmen.
  const win = resolved.closed ? frameOf(schedule.workHours.holiday) : resolved.window;
  const [start, setStart] = useState(minutesToTime(shift?.startMinutes ?? win.startMinutes));
  const [end, setEnd] = useState(minutesToTime(shift?.endMinutes ?? win.endMinutes));
  const [pause, setPause] = useState(String(shift?.pauseMinutes ?? 30));

  let paidPreview = 0;
  let parseError = "";
  try {
    paidPreview = timeToMinutes(end) - timeToMinutes(start) - Number(pause);
  } catch (e) {
    parseError = e instanceof Error ? e.message : "Giờ không hợp lệ";
  }
  const suggestedPause = calculatePause(Math.max(0, paidPreview));

  // Nhân viên còn rảnh trong ngày này (để „chuyển ca").
  const freeEmployees = schedule.employees.filter(
    (e) => e.id !== employeeId && !findShift(e.id, date),
  );

  const weekday = WEEKDAY_LABELS_VI[weekdayKeyOf(parseIsoDate(date))];

  function save() {
    if (parseError) return;
    const s = timeToMinutes(start);
    const en = timeToMinutes(end);
    const p = Number(pause);
    if (shift) {
      editShiftTimes(shift.id, { startMinutes: s, endMinutes: en, pauseMinutes: p });
    } else {
      addShift(employeeId, date, s, en, p);
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="font-semibold text-slate-900">{employee.name}</h3>
          <p className="text-xs text-slate-500">
            {weekday}, {isoLabel(date)}
          </p>
          {resolved.closed && (
            <p className="text-xs text-rose-600 mt-0.5">
              Ngày này được đặt „đóng cửa" — ca thêm ở đây là ngoại lệ.
            </p>
          )}
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col">
              <span className="text-xs text-slate-600 mb-1">Giờ vào</span>
              <input type="time" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-slate-600 mb-1">Giờ ra</span>
              <input type="time" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-slate-600 mb-1">Nghỉ (phút)</span>
              <input
                type="number"
                min={0}
                step={5}
                className={inputClass}
                value={pause}
                onChange={(e) => setPause(e.target.value)}
              />
            </label>
          </div>

          {parseError ? (
            <div className="text-sm text-rose-600">{parseError}</div>
          ) : (
            <div className="text-sm text-slate-600">
              Giờ công: <span className="font-medium">{minutesToShortHours(paidPreview)}</span>
              {paidPreview > 9 * 60 && <span className="text-rose-600"> · quá 9 giờ!</span>}
              {Number(pause) !== suggestedPause && (
                <span className="text-amber-600"> · nghỉ đề xuất: {suggestedPause} phút</span>
              )}
            </div>
          )}

          {freeEmployees.length > 0 && shift && (
            <label className="flex flex-col">
              <span className="text-xs text-slate-600 mb-1">Chuyển ca sang</span>
              <select
                className={inputClass}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    moveShiftToEmployee(shift.id, e.target.value);
                    onClose();
                  }
                }}
              >
                <option value="">— Chọn nhân viên —</option>
                {freeEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
          <button
            onClick={save}
            disabled={!!parseError}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
          >
            {shift ? "Lưu" : "Thêm ca"}
          </button>
          {shift && (
            <>
              <button
                onClick={() => {
                  setFrei(employeeId, date);
                  onClose();
                }}
                className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
              >
                Đánh dấu nghỉ
              </button>
              <button
                onClick={() => {
                  deleteShift(shift.id);
                  onClose();
                }}
                className="rounded border border-rose-300 text-rose-600 px-3 py-2 text-sm hover:bg-rose-50"
              >
                Xoá
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
          >
            Huỷ
          </button>
        </div>
      </div>
    </div>
  );
}
