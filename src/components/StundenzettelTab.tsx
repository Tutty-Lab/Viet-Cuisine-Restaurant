import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee } from "../types";
import { StundenzettelPage } from "./StundenzettelPage";
import { buildStundenzettelPdf, savePdf, safeFileName } from "../lib/pdf";
import { weeksOfMonth } from "../lib/weeks";
import { effectiveWeekdayKey } from "../lib/workHours";
import { publicHolidays } from "../lib/holidays";

export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, isLocked, markWeekPrinted, unlockMonth, generate } = store;

  const hasSplitSunday = useMemo(() => {
    const holidays = publicHolidays(schedule.year);
    for (const s of schedule.shifts) {
      if (effectiveWeekdayKey(s.date, holidays) === "sunday") {
        const count = schedule.shifts.filter(
          (other) => other.date === s.date && other.employeeId === s.employeeId,
        ).length;
        if (count > 1 || s.paidMinutes > 7 * 60) return true;
      }
    }
    return false;
  }, [schedule.year, schedule.shifts]);

  // ── Auswahl: WER (eine Person oder der ganze Laden) und WAS ─────────────
  // who: "all" = ganzer Laden, sonst eine employeeId.
  const [who, setWho] = useState<string>("all");
  // what: "stundenzettel" (Monats-Stundenzettel) | "sz-<weekStart>" (Wochen-Zettel).
  const [what, setWhat] = useState<string>("stundenzettel");

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string>("");

  /** Zweiter Klick für das Entsperren – ohne native Dialoge, siehe unten. */
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;

  // Für WER: die betroffenen Mitarbeiter (Reihenfolge wie im Plan).
  const chosenEmployees =
    who === "all"
      ? schedule.employees
      : schedule.employees.filter((e) => e.id === who);
  // Für die Vorschau und die Dateinamen: eine konkrete Person.
  const previewEmployee =
    who === "all" ? schedule.employees[0] ?? null : chosenEmployees[0] ?? null;
  const whoTag = who === "all" ? "tat_ca" : safeFileName(previewEmployee?.name ?? who);

  /**
   * Stundenzettel-PDF (echtes Vektor-PDF): eine Seite je Mitarbeiter. Kein
   * Screenshot, keine Offscreen-Bühne – der Inhalt kommt direkt aus den Daten.
   */
  async function doPdf(
    list: Employee[],
    filename: string,
    sz?: { dates?: string[]; label?: string; weekStart?: string },
  ) {
    if (list.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    setPdfProgress(list.length > 1 ? `1/${list.length}` : "");
    // Kurzer Yield, damit der „Đang tạo PDF…"-Zustand zuerst sichtbar wird.
    await new Promise((r) => setTimeout(r, 0));
    try {
      const doc = await buildStundenzettelPdf(
        schedule,
        list,
        { dates: sz?.dates, periodLabel: sz?.label },
        (current, total) => {
          if (total > 1) setPdfProgress(`${current}/${total}`);
        },
      );
      savePdf(doc, filename);
      // Ein ausgegebener Wochen-Zettel sperrt den Monat: der Stand im System muss
      // exakt dem Papier entsprechen, das im Betrieb liegt.
      if (sz?.weekStart) markWeekPrinted(sz.weekStart);
    } catch (err) {
      alert(`Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfBusy(false);
      setPdfProgress("");
    }
  }

  // Wochen-Stundenzettel: nur die Tage dieser Woche, mit Wochentitel oben rechts.
  function szWeekFor(weekStart: string): { dates: string[]; label: string } | null {
    const w = weeks.find((x) => x.weekStart === weekStart);
    if (!w) return null;
    return { dates: w.dates, label: `Woche ${w.label}${schedule.year}` };
  }

  function onPdf() {
    if (what === "stundenzettel") {
      void doPdf(chosenEmployees, `Stundenzettel_${whoTag}_${monthTag}.pdf`);
      return;
    }
    if (what.startsWith("sz-")) {
      const weekStart = what.slice(3);
      const sz = szWeekFor(weekStart);
      if (sz) {
        void doPdf(chosenEmployees, `Stundenzettel_${whoTag}_${monthTag}_tuan_${weekStart}.pdf`, {
          ...sz,
          weekStart,
        });
      }
    }
  }

  // Vùng in KHÔNG được dọn theo sự kiện "afterprint": trên Android sự kiện đó
  // bắn ra ngay khi gọi window.print(), trước lúc trình duyệt dựng xong trang
  // — nội dung bị xoá mất và tờ in ra trắng. Vùng này vốn đã ẩn trên màn hình
  // nên cứ để nguyên; lần in sau sẽ ghi đè bằng danh sách mới.

  if (schedule.employees.length === 0) {
    return (
      <div className="no-print rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
        Vui lòng thêm nhân viên và tạo lịch làm việc trước.
      </div>
    );
  }

  const hasSchedule = schedule.shifts.length > 0;

  return (
    <>
      {/* Điều khiển (không in) */}
      <div className="no-print">
        {/* ---- In & Xuất ---- */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Xuất file PDF</div>

          <div className="flex flex-wrap items-end gap-3">
            {/* WER */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Cho ai</span>
              <select
                className="rounded border border-slate-300 px-2 py-2 text-sm min-w-[10rem]"
                value={who}
                onChange={(e) => setWho(e.target.value)}
              >
                <option value="all">Tất cả (cả quán)</option>
                {schedule.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>

            {/* WAS */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Nội dung</span>
              <select
                className="rounded border border-slate-300 px-2 py-2 text-sm min-w-[14rem]"
                value={what}
                onChange={(e) => setWhat(e.target.value)}
              >
                <option value="stundenzettel">Bảng chấm công (Stundenzettel) — cả tháng</option>
                {weeks.map((w) => {
                  const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
                  return (
                    <option key={`sz-${w.weekStart}`} value={`sz-${w.weekStart}`}>
                      Bảng chấm công (Stundenzettel) — tuần {w.label}
                      {printed ? " ✓ (đã xuất)" : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            {/* Hành động */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={pdfBusy || !hasSchedule}
                onClick={onPdf}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40 shadow-sm"
              >
                {pdfBusy ? `Đang tạo PDF ${pdfProgress ? `(${pdfProgress})` : "…"}` : "⬇ Xuất PDF"}
              </button>
              <button
                type="button"
                disabled={pdfBusy || schedule.employees.length === 0}
                onClick={() => {
                  if (isLocked) unlockMonth();
                  generate();
                }}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 shadow-sm"
                title="Tạo lại lịch mới theo quy tắc ca liền Chủ nhật"
              >
                🔄 Tạo lại lịch
              </button>
              {pdfBusy && (
                <span className="text-sm text-slate-500">
                  {pdfProgress ? `Đang xử lý trang ${pdfProgress}…` : "Đang tạo PDF…"}
                </span>
              )}
            </div>
          </div>

          {hasSplitSunday && (
            <div className="mt-3 rounded-lg bg-blue-50 border border-blue-300 p-3 text-blue-950 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
              <div>
                <div className="font-semibold flex items-center gap-1.5 text-blue-900">
                  <span>💡 Cập nhật mới: Lịch chia đều theo hợp đồng tuần</span>
                </div>
                <p className="text-xs text-blue-800 mt-0.5">
                  Lịch hiện tại đang là bản cũ (Chủ nhật bị dồn ca 8h–9h hoặc chia 2 ca sáng/chiều). Hãy bấm nút bên cạnh để cập nhật sang <b>ca đều (5h–7h)</b> chuẩn theo giờ tuần.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isLocked) unlockMonth();
                  generate();
                }}
                className="whitespace-nowrap rounded bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 active:bg-blue-800 shadow"
              >
                🔄 Cập nhật lại lịch chuẩn ngay
              </button>
            </div>
          )}

          {!hasSchedule && (
            <p className="mt-2 text-sm text-slate-400">
              Chưa có lịch. Sang tab „Lịch làm việc" để tạo.
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500">
            <b>Bảng chấm công (Stundenzettel)</b> theo mẫu tiếng Đức để nộp — một tờ mỗi người, chọn
            cả tháng hoặc từng tuần, cho cả quán hoặc một người.{" "}
            <b>Xuất một tuần sẽ khóa lịch tháng</b> để bản đã xuất luôn khớp với hệ thống. Xuất PDF
            tải thẳng file về máy dưới dạng tệp PDF (tối ưu cho iPhone, iPad, Safari, Chrome).
          </p>

          {isLocked && (
            <div className="mt-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
              <div className="font-medium">
                Lịch tháng này đã khóa vì đã in
                {schedule.lockedAt &&
                  ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`}
                .
              </div>
              <div className="mt-0.5">
                Không sửa được ca, không đổi nhân viên. Vẫn in được bình thường. (Tạo lại lịch ở tab
                „Lịch làm việc" cũng sẽ mở khóa.)
              </div>

              {/*
                Bewusst KEIN window.confirm: In-App-Browser (Messenger,
                Facebook) unterdrücken die native Rückfrage teilweise. Sie
                liefert dann stillschweigend false, der Klick tut nichts, und
                niemand erfährt warum. Die Rückfrage steht deshalb direkt hier.
              */}
              {!confirmUnlock ? (
                <button
                  onClick={() => setConfirmUnlock(true)}
                  className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Mở khóa
                </button>
              ) : (
                <div className="mt-2 rounded border border-amber-300 bg-white px-3 py-2">
                  <div className="text-amber-900">
                    Mở khóa lịch tháng này? Bản đã in ở quán sẽ không còn khớp với hệ thống. Sau
                    khi sửa, hãy in lại tuần đó và thay bản cũ.
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        unlockMonth();
                        setConfirmUnlock(false);
                      }}
                      className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      Xác nhận mở khóa
                    </button>
                    <button
                      onClick={() => setConfirmUnlock(false)}
                      className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                    >
                      Huỷ
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Xem trước trên màn hình cho nhân viên đã chọn */}
        {previewEmployee && (
          <>
            <div className="mb-1 text-xs text-slate-500">
              Xem trước bảng chấm công: <b>{previewEmployee.name}</b>
              {who === "all" && " (chọn một người ở ô „Cho ai“ để xem người khác)"}
            </div>
            <div className="rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
              <StundenzettelPage schedule={schedule} employee={previewEmployee} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
