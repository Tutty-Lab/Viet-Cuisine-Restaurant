// ============================================================================
// Urlaubstage auswählen: ein kleiner Monatskalender zum Antippen.
//
// Vorher stand hier eine Liste aller Monatstage mit Häkchen – einunddreißig
// Zeilen in einem eigenen Scrollbereich, für jeden Mitarbeiter. Im Dialog vor
// dem Planen waren das sechs Scrollfenster in einem scrollenden Fenster, und
// bei einer Aushilfe, die nur sonntags kommt, standen dort auch Dienstag,
// Mittwoch, Donnerstag – Tage, an denen Urlaub gar nichts bedeutet.
//
// Jetzt: sieben Spalten Mo–So, ein Tag ein Feld. Der Wochentag steht über der
// Spalte, ein Tipp schaltet den Tag um. Gesperrt (grau) sind Tage, an denen der
// Laden zu hat, und Tage, an denen die Person laut ihren festen Wochentagen
// ohnehin nicht arbeitet. Ein schon gewählter Tag bleibt immer abwählbar.
// ============================================================================

import { WEEKDAY_SHORT_VI, parseIsoDate, weekdayKeyOf, type WeekdayKey } from "../lib/demand";

/** ISO-Datum "yyyy-MM-dd" für einen Tag des Monats. */
function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const SPALTEN: WeekdayKey[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export function VacationPicker({
  year,
  month,
  selected,
  onToggle,
  isClosed,
  availableWeekdays,
}: {
  year: number;
  month: number;
  /** Bereits gewählte Urlaubstage als ISO-Daten. */
  selected: string[];
  onToggle: (iso: string) => void;
  /** Tage, an denen der Laden zu hat – dort ist Urlaub sinnlos. */
  isClosed?: (iso: string) => boolean;
  /** Feste Arbeitstage der Person; fehlt/leer = alle Tage. */
  availableWeekdays?: WeekdayKey[];
}) {
  const tageImMonat = new Date(year, month, 0).getDate();
  const gewaehlt = new Set(selected);
  // Leere Felder vor dem 1., damit der Tag unter seinem Wochentag steht.
  const versatz = SPALTEN.indexOf(weekdayKeyOf(parseIsoDate(isoOf(year, month, 1))));
  const arbeitstag = (key: WeekdayKey) =>
    !availableWeekdays || availableWeekdays.length === 0 || availableWeekdays.includes(key);

  return (
    <div className="inline-block rounded border border-slate-200 p-1.5">
      <div className="grid grid-cols-7 gap-1">
        {SPALTEN.map((key) => (
          <div
            key={key}
            className={`text-center text-[10px] font-medium ${arbeitstag(key) ? "text-slate-500" : "text-slate-300"}`}
          >
            {WEEKDAY_SHORT_VI[key]}
          </div>
        ))}
        {Array.from({ length: versatz }, (_, i) => (
          <div key={`leer-${i}`} />
        ))}
        {Array.from({ length: tageImMonat }, (_, i) => {
          const tag = i + 1;
          const iso = isoOf(year, month, tag);
          const an = gewaehlt.has(iso);
          const zu = isClosed?.(iso) === true;
          const frei = !arbeitstag(weekdayKeyOf(parseIsoDate(iso)));
          // Ein bereits gewählter Tag lässt sich immer abwählen – auch wenn er
          // inzwischen gesperrt wäre (z. B. Wochentage nachträglich geändert).
          const gesperrt = (zu || frei) && !an;
          const grund = zu ? "Quán đóng cửa" : frei ? "Người này không làm ngày này" : undefined;
          return (
            <button
              key={iso}
              type="button"
              disabled={gesperrt}
              onClick={() => onToggle(iso)}
              title={gesperrt ? grund : an ? "Bấm để bỏ ngày nghỉ" : "Bấm để chọn ngày nghỉ"}
              aria-pressed={an}
              className={`h-8 w-8 rounded text-sm tabular-nums transition-colors ${
                an
                  ? "bg-amber-500 font-semibold text-white hover:bg-amber-600"
                  : gesperrt
                    ? zu
                      ? "cursor-not-allowed text-slate-300 line-through"
                      : "cursor-not-allowed text-slate-300"
                    : "text-slate-700 hover:bg-amber-50 hover:text-amber-900"
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
