import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee } from "../types";
import { StundenzettelPage } from "./StundenzettelPage";
import { SchedulePrintPage, type SchedulePrintLayout } from "./SchedulePrintPage";
import { elementsToPdf, safeFileName } from "../lib/pdf";
import { weeksOfMonth } from "../lib/weeks";
import { datesOfMonth } from "../lib/demand";
import { monthLabel } from "../lib/shiftOps";

/** Dienstplan-Ausdruck (Monat oder eine Woche), evtl. auf eine Person gefiltert. */
type ScheduleRange = {
  dates: string[];
  title: string;
  layout: SchedulePrintLayout;
  employeeIds?: string[];
  /** Gesetzt bei einer Woche: nach dem Ausgeben wird der Monat gesperrt. */
  weekStart?: string;
};

export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, isLocked, markWeekPrinted, unlockMonth } = store;

  // ── Auswahl: WER (eine Person oder der ganze Laden) und WAS ─────────────
  // who: "all" = ganzer Laden, sonst eine employeeId.
  const [who, setWho] = useState<string>("all");
  // what: "stundenzettel" (Monats-Stundenzettel) | "month" (Dienstplan Monat)
  //       | ein weekStart (Dienstplan dieser Woche).
  const [what, setWhat] = useState<string>("stundenzettel");

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  // Druck-/PDF-Bühne.
  const [printList, setPrintList] = useState<Employee[] | null>(null);
  const [scheduleRange, setScheduleRange] = useState<ScheduleRange | null>(null);
  const [pdfList, setPdfList] = useState<Employee[] | null>(null);
  const [pdfSchedule, setPdfSchedule] = useState<ScheduleRange | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfStage = useRef<HTMLDivElement>(null);

  // Zeitraum für den Stundenzettel-Ausdruck: gesetzt => Wochen-Zettel (nur diese
  // Tage), leer => ganzer Monat.
  const [szDates, setSzDates] = useState<string[] | undefined>(undefined);
  const [szLabel, setSzLabel] = useState<string | undefined>(undefined);

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
  const employeeIds = who === "all" ? undefined : [who];
  const whoTag = who === "all" ? "tat_ca" : safeFileName(previewEmployee?.name ?? who);

  // Vùng in phải được render TRƯỚC khi gọi print, và print phải nằm trong cùng
  // thao tác chạm (mobile chặn print ngoài gesture). flushSync render đồng bộ.
  function doPrint(list: Employee[], sz?: { dates?: string[]; label?: string }) {
    if (list.length === 0) return;
    flushSync(() => {
      setScheduleRange(null);
      setSzDates(sz?.dates);
      setSzLabel(sz?.label);
      setPrintList(list);
    });
    window.print();
  }

  /**
   * Dienstplan drucken. Der Wochen-Ausdruck sperrt den Monat: das Blatt hängt
   * danach im Laden und muss mit dem Stand im System übereinstimmen. Der
   * Monatsausdruck ist nur eine Übersicht und sperrt nichts.
   */
  function printSchedule(range: ScheduleRange) {
    if (range.dates.length === 0) return;
    flushSync(() => {
      setPrintList(null);
      setScheduleRange(range);
    });
    window.print();
    if (range.weekStart) markWeekPrinted(range.weekStart);
  }

  /**
   * PDF: các trang phải được render thật (không display:none) thì html2canvas
   * mới chụp được – vì vậy dùng "sân khấu" nằm ngoài màn hình.
   */
  async function doPdf(
    list: Employee[],
    filename: string,
    sz?: { dates?: string[]; label?: string },
  ) {
    if (list.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    flushSync(() => {
      setPdfSchedule(null);
      setSzDates(sz?.dates);
      setSzLabel(sz?.label);
      setPdfList(list);
    });
    try {
      const pages = Array.from(
        pdfStage.current?.querySelectorAll<HTMLElement>(".stundenzettel-page") ?? [],
      );
      await elementsToPdf(pages, filename);
    } catch (err) {
      alert(`Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfList(null);
      setPdfBusy(false);
    }
  }

  /** PDF eines Dienstplans (Monat oder Woche). Eine Woche sperrt den Monat. */
  async function doPdfSchedule(range: ScheduleRange, filename: string) {
    if (range.dates.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    flushSync(() => {
      setPdfList(null);
      setPdfSchedule(range);
    });
    try {
      const pages = Array.from(
        pdfStage.current?.querySelectorAll<HTMLElement>(".stundenzettel-page") ?? [],
      );
      await elementsToPdf(pages, filename);
      if (range.weekStart) markWeekPrinted(range.weekStart);
    } catch (err) {
      alert(`Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfSchedule(null);
      setPdfBusy(false);
    }
  }

  // Was genau ist gewählt? Baut den passenden Ausdruck-Auftrag.
  function scheduleRangeFor(target: string): ScheduleRange | null {
    if (target === "month") {
      return {
        dates: datesOfMonth(schedule.year, schedule.month),
        title: monthLabel(schedule.year, schedule.month),
        // 31 Tagesspalten passen nicht hochkant auf A4.
        layout: "byDate",
        employeeIds,
      };
    }
    const w = weeks.find((x) => x.weekStart === target);
    if (!w) return null;
    return {
      dates: w.dates,
      title: `Woche ${w.label} · ${monthLabel(schedule.year, schedule.month)}`,
      // Leute untereinander, Tage nebeneinander – bei 7 Spalten gut auf Papier.
      layout: "byEmployee",
      employeeIds,
      weekStart: w.weekStart,
    };
  }

  // Wochen-Stundenzettel: nur die Tage dieser Woche, mit Wochentitel oben rechts.
  function szWeekFor(weekStart: string): { dates: string[]; label: string } | null {
    const w = weeks.find((x) => x.weekStart === weekStart);
    if (!w) return null;
    return { dates: w.dates, label: `Woche ${w.label}${schedule.year}` };
  }

  function onPrint() {
    if (what === "stundenzettel") {
      doPrint(chosenEmployees);
      return;
    }
    if (what.startsWith("sz-")) {
      const sz = szWeekFor(what.slice(3));
      if (sz) doPrint(chosenEmployees, sz);
      return;
    }
    const range = scheduleRangeFor(what);
    if (range) printSchedule(range);
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
        void doPdf(chosenEmployees, `Stundenzettel_${whoTag}_${monthTag}_tuan_${weekStart}.pdf`, sz);
      }
      return;
    }
    const range = scheduleRangeFor(what);
    if (!range) return;
    const suffix = what === "month" ? "thang" : `tuan_${what}`;
    void doPdfSchedule(range, `Dienstplan_${whoTag}_${suffix}_${monthTag}.pdf`);
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
          <div className="text-sm font-medium text-slate-700 mb-2">In &amp; Xuất file</div>

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
                {weeks.map((w) => (
                  <option key={`sz-${w.weekStart}`} value={`sz-${w.weekStart}`}>
                    Bảng chấm công (Stundenzettel) — tuần {w.label}
                  </option>
                ))}
                <option value="month">Lịch làm việc — cả tháng</option>
                {weeks.map((w) => {
                  const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
                  return (
                    <option key={w.weekStart} value={w.weekStart}>
                      Lịch làm việc — tuần {w.label}
                      {printed ? " ✓ (đã in)" : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            {/* Hành động */}
            <div className="flex items-center gap-2">
              <button
                disabled={pdfBusy || !hasSchedule}
                onClick={onPrint}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
              >
                🖨 In
              </button>
              <button
                disabled={pdfBusy || !hasSchedule}
                onClick={onPdf}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
              >
                ⬇ Xuất PDF
              </button>
              {pdfBusy && <span className="text-sm text-slate-500">Đang tạo PDF…</span>}
            </div>
          </div>

          {!hasSchedule && (
            <p className="mt-2 text-sm text-slate-400">
              Chưa có lịch. Sang tab „Lịch làm việc" để tạo.
            </p>
          )}

          <p className="mt-2 text-xs text-slate-500">
            <b>Bảng chấm công (Stundenzettel)</b> theo mẫu tiếng Đức để nộp — một tờ mỗi người, chọn
            cả tháng hoặc từng tuần. <b>Lịch làm việc</b> là lịch treo ở quán (cả tháng hoặc từng
            tuần, cho cả quán hoặc một người). <b>In lịch một tuần sẽ khóa lịch tháng</b> để bản
            treo luôn khớp với hệ thống. Xuất PDF tải thẳng file về máy; trên điện thoại mở bảng
            Chia sẻ.
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

      {/* Vùng in ẩn: hoặc các tờ chấm công, hoặc lịch làm việc */}
      <div className="print-area">
        {scheduleRange ? (
          <SchedulePrintPage
            schedule={schedule}
            dates={scheduleRange.dates}
            title={scheduleRange.title}
            layout={scheduleRange.layout}
            employeeIds={scheduleRange.employeeIds}
          />
        ) : (
          (printList ?? []).map((emp) => (
            <StundenzettelPage
              key={emp.id}
              schedule={schedule}
              employee={emp}
              dates={szDates}
              periodLabel={szLabel}
            />
          ))
        )}
      </div>

      {/* Sân khấu ngoài màn hình – chỉ có nội dung trong lúc tạo PDF */}
      <div ref={pdfStage} aria-hidden="true" className="pdf-stage no-print">
        {pdfSchedule ? (
          <SchedulePrintPage
            schedule={schedule}
            dates={pdfSchedule.dates}
            title={pdfSchedule.title}
            layout={pdfSchedule.layout}
            employeeIds={pdfSchedule.employeeIds}
          />
        ) : (
          (pdfList ?? []).map((emp) => (
            <StundenzettelPage
              key={emp.id}
              schedule={schedule}
              employee={emp}
              dates={szDates}
              periodLabel={szLabel}
            />
          ))
        )}
      </div>
    </>
  );
}
