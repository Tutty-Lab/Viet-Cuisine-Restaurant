import type { Schedule, Shift } from "../types";
import {
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  WEEKDAY_SHORT_DE,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToShortHours, minutesToTime } from "../lib/time";
import { publicHolidayNames, publicHolidays } from "../lib/holidays";
import { isDayClosed } from "../lib/workHours";
import { format } from "date-fns";

/**
 * Wie herum die Tabelle steht.
 *
 * "byEmployee" – Mitarbeiter als Zeilen, Tage als Spalten. Genau wie das
 *   Raster in der App, und für eine Woche (7 Spalten) auch auf Papier gut.
 * "byDate" – Tage als Zeilen. Für einen ganzen Monat die einzige Variante,
 *   die hochkant auf A4 passt: 31 Tagesspalten tun das nicht.
 */
export type SchedulePrintLayout = "byEmployee" | "byDate";

/**
 * Eine Zelle kann MEHRERE Dienste enthalten – mittags und abends. Steht dort
 * nur einer, fehlt auf dem ausgehängten Plan die halbe Wahrheit.
 */
function ShiftCell({ shifts, closed }: { shifts: Shift[]; closed: boolean }) {
  if (shifts.length === 0) {
    return <span className="text-slate-400">{closed ? "—" : "frei"}</span>;
  }
  return (
    <>
      {shifts.map((shift) => (
        <div key={shift.id}>
          <div className="whitespace-nowrap">
            {minutesToTime(shift.startMinutes)}–{minutesToTime(shift.endMinutes)}
          </div>
          <div className="text-[10px] text-slate-500">
            {minutesToShortHours(shift.paidMinutes)}
            {shift.pauseMinutes > 0 && ` · P ${shift.pauseMinutes}`}
          </div>
        </div>
      ))}
    </>
  );
}

/** Druckbarer Dienstplan für einen Zeitraum (ganzer Monat oder eine Woche). */
export function SchedulePrintPage({
  schedule,
  dates,
  title,
  layout = "byDate",
}: {
  schedule: Schedule;
  dates: string[];
  title: string;
  layout?: SchedulePrintLayout;
}) {
  const byKey = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    const key = `${s.employeeId}#${s.date}`;
    const liste = byKey.get(key);
    if (liste) liste.push(s);
    else byKey.set(key, [s]);
  }
  for (const liste of byKey.values()) liste.sort((a, b) => a.startMinutes - b.startMinutes);

  const holidays = publicHolidays(schedule.year);
  const holidayNames = publicHolidayNames(schedule.year);
  const overrides = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
  const closedOn = (d: string) => isDayClosed(schedule.workHours, d, holidays, overrides);

  const th = "border border-slate-300 px-2 py-1 font-semibold";
  const td = "border border-slate-300 px-2 py-[3px]";

  return (
    <div className="stundenzettel-page bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Dienstplan</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">
          <div className="font-medium">{title}</div>
        </div>
      </div>

      {layout === "byEmployee" ? (
        // Mitarbeiter als Zeilen, Tage als Spalten – wie in der App.
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className={`${th} text-left`}>Mitarbeiter</th>
              {dates.map((d) => (
                <th key={d} className={`${th} text-center`}>
                  <div>{WEEKDAY_SHORT_DE[weekdayKeyOf(parseIsoDate(d))]}</div>
                  <div className="font-normal">{format(parseIsoDate(d), "dd.MM.")}</div>
                </th>
              ))}
              <th className={`${th} text-right`}>Summe</th>
            </tr>
          </thead>
          <tbody>
            {schedule.employees.map((e) => {
              const own = dates.flatMap((d) => byKey.get(`${e.id}#${d}`) ?? []);
              const total = own.reduce((sum, s) => sum + (s?.paidMinutes ?? 0), 0);
              return (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap`}>{e.name}</td>
                  {dates.map((d) => (
                    <td key={d} className={`${td} text-center ${closedOn(d) ? "bg-slate-50" : ""}`}>
                      <ShiftCell shifts={byKey.get(`${e.id}#${d}`) ?? []} closed={closedOn(d)} />
                    </td>
                  ))}
                  <td className={`${td} text-right font-medium`}>{minutesToShortHours(total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100">
              <td className={`${td} text-left font-semibold`}>Besetzung</td>
              {dates.map((d) => {
                const n = schedule.employees.filter((e) => byKey.has(`${e.id}#${d}`)).length;
                return (
                  <td key={d} className={`${td} text-center`}>
                    {closedOn(d) ? "—" : n}
                  </td>
                );
              })}
              <td className={td} />
            </tr>
          </tfoot>
        </table>
      ) : (
        // Tage als Zeilen – für den ganzen Monat.
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-slate-100">
              <th className={`${th} text-left`}>Datum</th>
              <th className={`${th} text-left`}>Wochentag</th>
              {schedule.employees.map((e) => (
                <th key={e.id} className={`${th} text-center`}>
                  {e.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => {
              const closed = closedOn(d);
              const holiday = holidayNames.get(d);
              return (
                <tr key={d} className={closed ? "bg-slate-50" : ""}>
                  <td className={td}>{format(parseIsoDate(d), "dd.MM.yyyy")}</td>
                  <td className={td}>
                    {WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))]}
                    {holiday && <span className="text-slate-500"> · {holiday}</span>}
                  </td>
                  {schedule.employees.map((e) => (
                    <td key={e.id} className={`${td} text-center`}>
                      <ShiftCell shifts={byKey.get(`${e.id}#${d}`) ?? []} closed={closed} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="mt-8 grid grid-cols-2 gap-8 text-[11px]">
        <div className="border-t border-slate-500 pt-1 mt-8 text-slate-600">
          Unterschrift Arbeitgeber
        </div>
        <div className="border-t border-slate-500 pt-1 mt-8 text-slate-600">Datum</div>
      </div>
    </div>
  );
}
