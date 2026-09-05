// ============================================================================
// Urlaubstage auswählen: eine Liste der Monatstage zum Ankreuzen.
//
// Vorher stand hier ein <input type="date">. Man musste den Tag im Kalender
// des Browsers suchen oder ihn als mm/dd/yyyy eintippen, und das für JEDEN
// einzelnen Tag neu – für eine Woche Urlaub sieben Mal.
//
// Die Liste zeigt zu jedem Tag den Wochentag dazu. Das ist der Grund für die
// Liste statt eines Kalenderrasters: beim Urlaub geht es fast immer darum, an
// welchen Wochentagen jemand fehlt, und in einer Zeile steht das direkt neben
// dem Datum, statt aus der Spaltenposition erschlossen zu werden.
// ============================================================================

import { WEEKDAY_LABELS_VI, parseIsoDate, weekdayKeyOf } from "../lib/demand";

/** ISO-Datum "yyyy-MM-dd" für einen Tag des Monats. */
function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function VacationPicker({
  year,
  month,
  selected,
  onToggle,
  isClosed,
}: {
  year: number;
  month: number;
  /** Bereits gewählte Urlaubstage als ISO-Daten. */
  selected: string[];
  onToggle: (iso: string) => void;
  /** Tage, an denen der Laden zu hat – dort ist Urlaub sinnlos. */
  isClosed?: (iso: string) => boolean;
}) {
  const tageImMonat = new Date(year, month, 0).getDate();
  const gewaehlt = new Set(selected);

  return (
    // Fest begrenzte Höhe mit eigenem Scrollbereich: einunddreißig Zeilen mal
    // sieben Mitarbeiter wären sonst eine sehr lange Seite.
    <div className="max-h-56 w-56 overflow-y-auto rounded border border-slate-200">
      {Array.from({ length: tageImMonat }, (_, i) => {
        const tag = i + 1;
        const iso = isoOf(year, month, tag);
        const an = gewaehlt.has(iso);
        const zu = isClosed?.(iso) === true;
        return (
          <label
            key={iso}
            className={`flex items-center gap-2 border-b border-slate-100 px-2 py-1 text-sm last:border-b-0 ${
              zu
                ? "cursor-not-allowed text-slate-300"
                : an
                  ? "cursor-pointer bg-amber-50 text-amber-900"
                  : "cursor-pointer text-slate-600 hover:bg-slate-50"
            }`}
          >
            <input
              type="checkbox"
              checked={an}
              disabled={zu}
              onChange={() => onToggle(iso)}
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500 disabled:opacity-30"
            />
            <span className="w-6 text-right tabular-nums font-medium">{tag}</span>
            <span className="flex-1">{WEEKDAY_LABELS_VI[weekdayKeyOf(parseIsoDate(iso))]}</span>
            {zu && <span className="text-[10px]">đóng cửa</span>}
          </label>
        );
      })}
    </div>
  );
}
