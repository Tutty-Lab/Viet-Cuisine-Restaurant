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

export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, isLocked, markWeekPrinted, unlockMonth } = store;
  const [selectedId, setSelectedId] = useState<string>(schedule.employees[0]?.id ?? "");
  const [printList, setPrintList] = useState<Employee[] | null>(null);
  /** Dienstplan-Ausdruck (Monat oder Woche). Nie gleichzeitig mit printList. */
  const [scheduleRange, setScheduleRange] = useState<{
    dates: string[];
    title: string;
    layout: SchedulePrintLayout;
  } | null>(null);
  /** Zweiter Klick für das Entsperren – ohne native Dialoge, siehe unten. */
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  const [pdfList, setPdfList] = useState<Employee[] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pdfStage = useRef<HTMLDivElement>(null);

  const selected =
    schedule.employees.find((e) => e.id === selectedId) ?? schedule.employees[0] ?? null;

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;

  // Vùng in phải được render TRƯỚC khi gọi print, và print phải nằm trong cùng
  // thao tác chạm (mobile chặn print ngoài gesture). flushSync render đồng bộ.
  function doPrint(list: Employee[]) {
    if (list.length === 0) return;
    flushSync(() => {
      setScheduleRange(null);
      setPrintList(list);
    });
    window.print();
  }

  /**
   * Dienstplan drucken. Der Wochen-Ausdruck sperrt den Monat: das Blatt hängt
   * danach im Laden und muss mit dem Stand im System übereinstimmen. Der
   * Monatsausdruck ist nur eine Übersicht und sperrt nichts.
   */
  function printSchedule(
    dates: string[],
    title: string,
    layout: SchedulePrintLayout,
    weekStart?: string,
  ) {
    if (dates.length === 0) return;
    flushSync(() => {
      setPrintList(null);
      setScheduleRange({ dates, title, layout });
    });
    window.print();
    if (weekStart) markWeekPrinted(weekStart);
  }

  /**
   * PDF: các trang phải được render thật (không display:none) thì html2canvas
   * mới chụp được – vì vậy dùng "sân khấu" nằm ngoài màn hình.
   */
  async function doPdf(list: Employee[], filename: string) {
    if (list.length === 0 || pdfBusy) return;
    setPdfBusy(true);
    flushSync(() => setPdfList(list));
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

  return (
    <>
      {/* Điều khiển (không in) */}
      <div className="no-print">
        {/* ---- In lịch làm việc ---- */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
          <div className="text-sm font-medium text-slate-700 mb-2">In lịch làm việc</div>
          {schedule.shifts.length === 0 ? (
            <p className="text-sm text-slate-400">Chưa có lịch. Sang tab „Lịch làm việc" để tạo.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    printSchedule(
                      datesOfMonth(schedule.year, schedule.month),
                      monthLabel(schedule.year, schedule.month),
                      // 31 Tagesspalten passen nicht hochkant auf A4.
                      "byDate",
                    )
                  }
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  Cả tháng
                </button>
                <span className="text-slate-300">|</span>
                {weeks.map((w) => {
                  const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
                  return (
                    <button
                      key={w.weekStart}
                      onClick={() =>
                        printSchedule(
                          w.dates,
                          `Woche ${w.label} · ${monthLabel(schedule.year, schedule.month)}`,
                          // Wie das Raster in der App: Leute untereinander,
                          // Tage nebeneinander. Bei 7 Spalten passt das gut.
                          "byEmployee",
                          w.weekStart,
                        )
                      }
                      className={`rounded border px-3 py-1.5 text-sm ${
                        printed
                          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                          : "border-slate-300 bg-white hover:bg-slate-50"
                      }`}
                      title={printed ? "Tuần này đã in" : "In tuần này — sẽ khóa lịch tháng"}
                    >
                      {w.label}
                      {printed && " ✓"}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                In cả tháng chỉ để xem tổng thể, không khóa gì.{" "}
                <b>In một tuần bất kỳ sẽ khóa lịch tháng này</b> để bản treo ở quán luôn khớp với
                dữ liệu trong hệ thống.
              </p>
            </>
          )}

          {isLocked && (
            <div className="mt-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
              <div className="font-medium">
                Lịch tháng này đã khóa vì đã in
                {schedule.lockedAt &&
                  ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`}
                .
              </div>
              <div className="mt-0.5">
                Không sửa được ca, không tạo lại lịch, không đổi nhân viên. Vẫn in được bình thường.
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

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="text-sm text-slate-600">Nhân viên:</label>
          <select
            className="rounded border border-slate-300 px-2 py-2 text-sm"
            value={selected?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {schedule.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>

        {/* 4 thao tác: PDF / In, cho một người hoặc tất cả */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            disabled={pdfBusy || !selected}
            onClick={() =>
              selected &&
              void doPdf(
                [selected],
                `Stundenzettel_${safeFileName(selected.name)}_${monthTag}.pdf`,
              )
            }
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
          >
            Xuất PDF — người đang chọn
          </button>
          <button
            disabled={pdfBusy}
            onClick={() => void doPdf(schedule.employees, `Stundenzettel_tat_ca_${monthTag}.pdf`)}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
          >
            Xuất PDF — tất cả
          </button>
          <button
            disabled={pdfBusy || !selected}
            onClick={() => selected && doPrint([selected])}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
          >
            In — người đang chọn
          </button>
          <button
            disabled={pdfBusy}
            onClick={() => doPrint(schedule.employees)}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
          >
            In — tất cả
          </button>
          {pdfBusy && (
            <span className="text-sm text-slate-500">Đang tạo PDF…</span>
          )}
        </div>

        <p className="text-xs text-slate-500 mb-3">
          Tờ in <span className="font-medium">Stundenaufzeichnung</span> theo mẫu tiếng Đức (dùng nộp
          tại Đức). <span className="font-medium">Xuất PDF</span> tải thẳng file .pdf về máy — trên
          điện thoại sẽ mở bảng <span className="font-medium">Chia sẻ</span> để lưu vào Tệp hoặc gửi
          đi. <span className="font-medium">In</span> mở hộp thoại in; nếu in ra giấy thì chọn lề
          „Chuẩn", tỉ lệ 100 %.
        </p>

        {/* Xem trước trên màn hình cho nhân viên đã chọn */}
        {selected && (
          <div className="rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
            <StundenzettelPage schedule={schedule} employee={selected} />
          </div>
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
          />
        ) : (
          (printList ?? []).map((emp) => (
            <StundenzettelPage key={emp.id} schedule={schedule} employee={emp} />
          ))
        )}
      </div>

      {/* Sân khấu ngoài màn hình – chỉ có nội dung trong lúc tạo PDF */}
      <div ref={pdfStage} aria-hidden="true" className="pdf-stage no-print">
        {(pdfList ?? []).map((emp) => (
          <StundenzettelPage key={emp.id} schedule={schedule} employee={emp} />
        ))}
      </div>
    </>
  );
}
