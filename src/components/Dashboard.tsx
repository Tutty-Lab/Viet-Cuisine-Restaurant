import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToDecimalHours } from "../lib/time";
import { monthlyTargetMinutes } from "../lib/contract";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm">
      <div className="text-[11px] sm:text-xs text-slate-500 leading-tight">{label}</div>
      <div className={`text-base sm:text-lg font-semibold leading-tight ${accent ?? "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

/** "2026-08-27" -> "27.08." – kurz, weil oft mehrere Tage nebeneinander stehen. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

export function Dashboard({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, peakGaps, openDays } = store;
  const vz = schedule.employees.filter((e) => e.employmentType === "VOLLZEIT").length;
  const tz = schedule.employees.filter((e) => e.employmentType === "TEILZEIT").length;
  const mj = schedule.employees.filter((e) => e.employmentType === "MINIJOB").length;
  // Wochenverträge (weeklyHours) haben targetMinutes = 0; das Monats-Soll wird
  // erst über die offenen Tage abgeleitet (contract.ts), genau wie in der Prüfung.
  const targetMin = schedule.employees.reduce((s, e) => s + monthlyTargetMinutes(e, openDays), 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  const notGenerated = schedule.shifts.length === 0;

  // Trước khi tạo lịch: trạng thái trung tính (chưa xếp giờ nào nên chưa thể "lỗi").
  // Warnungen und Fehler getrennt zählen: ein zu hohes Monats-Soll macht den
  // Plan nicht unbrauchbar, es fehlen nur Stunden, die der Monat nicht hergibt.
  const warnungen = validation.errors.filter((e) => e.severity === "warning");
  const fehler = validation.errors.filter((e) => e.severity !== "warning");

  const statusValue = notGenerated
    ? "Chưa tạo lịch"
    : fehler.length > 0
      ? `${fehler.length} lỗi`
      : warnungen.length > 0
        ? `${warnungen.length} cảnh báo`
        : "Hợp lệ";
  const statusAccent = notGenerated
    ? "text-slate-500"
    : fehler.length > 0
      ? "text-rose-600"
      : warnungen.length > 0
        ? "text-amber-600"
        : "text-emerald-600";

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Stat label="Số nhân viên" value={String(schedule.employees.length)} />
        <Stat label="Toàn thời gian" value={String(vz)} />
        <Stat label="Bán thời gian" value={String(tz)} />
        <Stat label="Minijob" value={String(mj)} />
        <Stat label="Tổng giờ định mức" value={`${minutesToDecimalHours(targetMin)} h`} />
        <Stat label="Tổng giờ đã xếp" value={`${minutesToDecimalHours(plannedMin)} h`} />
        <Stat label="Trạng thái kiểm tra" value={statusValue} accent={statusAccent} />
      </div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          Chưa có lịch. Sang tab „Lịch làm việc" và bấm „Tạo lịch làm việc".
        </div>
      )}
      {validation.valid && warnungen.length === 0 && schedule.shifts.length > 0 && (
        <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">
          Tất cả giờ định mức đã được phân bổ chính xác.
        </div>
      )}

      {/*
        Zu hohes Soll: der Plan ist da und benutzbar, es fehlen nur Stunden,
        die der Monat nicht hergibt. Früher brach die Planung hier komplett ab
        und der Betrieb bekam GAR KEINEN Plan – wegen einer Zahl, die sich in
        zehn Sekunden korrigieren lässt.
      */}
      {warnungen.length > 0 && schedule.shifts.length > 0 && (
        <div className="mt-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          <div className="font-medium">
            Lịch đã tạo xong, nhưng {warnungen.length} người chưa đủ giờ định mức:
          </div>
          <ul className="mt-1 space-y-0.5">
            {warnungen.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
          <div className="mt-1 text-amber-700">
            Cách xử lý: giảm định mức cho những người này, mở thêm giờ làm, bớt ngày
            đóng cửa, hoặc chấp nhận phần thiếu và tự bù ở tháng sau.
          </div>
        </div>
      )}
      {/*
        Giờ cao điểm thiếu người KHÔNG phải lỗi định mức — lịch vẫn đúng giờ
        công. Nó chỉ có nghĩa là tổng giờ trong ngày quá mỏng để lúc nào cũng
        có 2 người. Trước đây chuyện này diễn ra âm thầm, không ai biết.
      */}
      {peakGaps.length > 0 && (
        <div className="mt-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          {/*
            Zeiten und Grenzen kommen aus PEAK_WINDOWS_BY_WEEKDAY. Sie sind je
            Wochentag verschieden (Di–Fr mittags, Sa/So abends), deshalb steht
            hier keine feste Uhrzeit mehr, sondern nur die Tage mit Abweichung.
          */}
          <div className="font-medium">
            {peakGaps.length} ngày chưa đúng số người trong giờ cao điểm.
          </div>
          <div className="mt-1 space-y-0.5">
            {peakGaps.slice(0, 6).map((d) => (
              <div key={d.date}>
                {shortDate(d.date)}{" "}
                {d.peaks
                  .filter((p) => !p.ok)
                  .map((p) =>
                    p.minStaff < p.required
                      ? `${p.label} thiếu: ${p.minStaff}/${p.required} người`
                      : `${p.label} thừa: ${p.maxStaff}, tối đa ${p.allowed}`,
                  )
                  .join(" · ")}{" "}
                <span className="opacity-70">({d.shiftCount} ca, {d.paidHours}h)</span>
              </div>
            ))}
            {peakGaps.length > 6 && <div className="opacity-70">… và {peakGaps.length - 6} ngày nữa</div>}
          </div>
          <div className="mt-1 opacity-80">
            Cách xử lý: tăng định mức cho nhân viên, thêm người, hoặc chấp nhận những ngày này.
          </div>
        </div>
      )}
    </div>
  );
}
