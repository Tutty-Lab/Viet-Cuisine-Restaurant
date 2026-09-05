import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToDecimalHours, minutesToTime } from "../lib/time";
import { MONTH_NAMES_DE } from "../lib/dateFormat";
import { publicHolidayNames } from "../lib/holidays";
import { format } from "date-fns";
import { employmentLabelDe } from "../lib/employment";

// Deutscher Monats-Titel für das offizielle Dokument.
function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

/**
 * Ein A4-freundlicher Stundenzettel für einen Mitarbeiter.
 * Wird sowohl für die Bildschirm-Vorschau als auch für den Druck verwendet.
 */
export function StundenzettelPage({
  schedule,
  employee,
}: {
  schedule: Schedule;
  employee: Employee;
}) {
  const dates = datesOfMonth(schedule.year, schedule.month);
  // MEHRERE Dienste je Tag: wer mittags und abends arbeitet, hat zwei. Vorher
  // stand hier eine Map auf EINEN Dienst – der zweite fiel lautlos aus dem
  // Stundenzettel, und damit aus der Lohnabrechnung.
  const byDate = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    if (s.employeeId !== employee.id) continue;
    const liste = byDate.get(s.date);
    if (liste) liste.push(s);
    else byDate.set(s.date, [s]);
  }
  for (const liste of byDate.values()) liste.sort((a, b) => a.startMinutes - b.startMinutes);

  const totalMinutes = [...byDate.values()]
    .flat()
    .reduce((a, s) => a + s.paidMinutes, 0);
  const holidayNames = publicHolidayNames(schedule.year);
  const closedByDate = new Map(
    schedule.dateOverrides.filter((o) => o.closed).map((o) => [o.date, o] as const),
  );

  return (
    <div className="stundenzettel-page bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Stundenaufzeichnung</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">
          <div>{monthLabelDe(schedule.year, schedule.month)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-3">
        <Info label="Firmenname" value={schedule.companyName || "—"} />
        <Info label="Beschäftigungsart" value={employmentLabelDe(employee.employmentType)} />
        <Info label="Mitarbeiter" value={employee.name} />
        <Info label="Monat" value={MONTH_NAMES_DE[schedule.month - 1]} />
        {/*
          Sollstunden bleibt auf dem Zettel bewusst LEER: der Betrieb trägt den
          Wert von Hand ein (Ausdruck wie PDF). Die geplante Zahl steht in der
          App (Tab Nhân viên) und gehört nicht auf das Dokument.
        */}
        <Info label="Sollstunden" blank />
        <Info label="Jahr" value={String(schedule.year)} />
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            <Th>Datum</Th>
            <Th>Wochentag</Th>
            <Th>Arbeitsbeginn</Th>
            <Th>Arbeitsende</Th>
            <Th>Pause</Th>
            <Th>Arbeitszeit</Th>
            <Th className="text-left">Bemerkung</Th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const dienste = byDate.get(d) ?? [];
            const s = dienste[0];
            // Bei zwei Diensten stehen beide Zeitspannen untereinander; Pause
            // und Stunden werden addiert, damit die Summe unten stimmt.
            const zeiten = (feld: "startMinutes" | "endMinutes") =>
              dienste.map((x) => minutesToTime(x[feld])).join(" / ");
            const pauseGesamt = dienste.reduce((a, x) => a + x.pauseMinutes, 0);
            const bezahltGesamt = dienste.reduce((a, x) => a + x.paidMinutes, 0);
            const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
            const holiday = holidayNames.get(d);
            const closed = closedByDate.get(d);
            const isWeekend = wd === "Samstag" || wd === "Sonntag";
            let bemerkung: string;
            if (s) {
              bemerkung = holiday ? `Feiertag: ${holiday}` : "";
            } else if (closed) {
              bemerkung = closed.note || "Betriebsruhe";
            } else if (holiday) {
              bemerkung = `Frei (Feiertag: ${holiday})`;
            } else {
              bemerkung = "Frei";
            }
            return (
              <tr key={d} className={isWeekend || holiday || closed ? "bg-slate-50" : ""}>
                <Td>{format(parseIsoDate(d), "dd.MM.yyyy")}</Td>
                <Td>{wd}</Td>
                <Td className="text-center">{s ? zeiten("startMinutes") : ""}</Td>
                <Td className="text-center">{s ? zeiten("endMinutes") : ""}</Td>
                <Td className="text-center">{s ? `${pauseGesamt} Min` : ""}</Td>
                <Td className="text-center">
                  {s ? minutesToDecimalHours(bezahltGesamt) : "0,00"}
                </Td>
                <Td className="text-left text-slate-500">{bemerkung}</Td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-slate-100">
            <Td className="text-left" colSpan={5}>
              Gesamtstunden
            </Td>
            <Td className="text-center">{minutesToDecimalHours(totalMinutes)}</Td>
            <Td />
          </tr>
        </tfoot>
      </table>

      {/*
        Nur die tatsächlich geleisteten Stunden werden gedruckt. Sollstunden und
        Differenz bleiben leer – sie werden auf dem Papier von Hand ergänzt.
      */}
      <div className="mt-3 grid grid-cols-3 gap-4 text-[12px]">
        <div>
          <div className="text-slate-500">Gesamtstunden</div>
          <div className="font-semibold">{minutesToDecimalHours(totalMinutes)} h</div>
        </div>
        <div>
          <div className="text-slate-500">Sollstunden</div>
          <BlankLine />
        </div>
        <div>
          <div className="text-slate-500">Differenz</div>
          <BlankLine />
        </div>
      </div>

      <div className="mt-10 grid grid-cols-3 gap-8 text-[11px]">
        <Signature label="Unterschrift Mitarbeiter" />
        <Signature label="Unterschrift Arbeitgeber" />
        <Signature label="Datum" />
      </div>
    </div>
  );
}

/** `blank` = Feld zum Ausfüllen von Hand statt eines gedruckten Werts. */
function Info({ label, value, blank }: { label: string; value?: string; blank?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}:</span>
      {blank ? (
        <span className="flex-1 border-b border-slate-400" />
      ) : (
        <span className="font-medium">{value}</span>
      )}
    </div>
  );
}

/** Leere Schreiblinie – markiert ein Feld, das von Hand ergänzt wird. */
function BlankLine() {
  return <div className="border-b border-slate-400 h-[1.2em] w-full max-w-[80px]" />;
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border border-slate-300 px-2 py-1 text-center font-semibold ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-slate-300 px-2 py-[3px] ${className}`}>
      {children}
    </td>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="border-t border-slate-500 pt-1 mt-8 text-slate-600">{label}</div>
    </div>
  );
}
