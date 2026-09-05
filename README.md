# Dienstplan & Stundenzettel — Viet Cuisine GmbH

Haupt Straße 11, 92348 Berg (Oberpfalz, Bayern). Abgeleitet aus der Kylan-App
(zwei Öffnungsblöcke je Tag, geteilte Dienste).

**Vorgaben des Betriebs:**

- **Montag geschlossen.**
- **Di–Sa zwei getrennte Blöcke:** 10:30–14:30 und 16:30–22:30
  (Mittagsschließung 14:30–16:30).
- **Sonntag und Feiertag durchgehend 10:30–22:00**, ohne Mittagspause. Feiertage
  sind also OFFEN (wie ein Sonntag) – Feiertage nach **Bayern** (Heilige Drei
  Könige, Fronleichnam, Mariä Himmelfahrt, Allerheiligen …).
- **Wochenverträge:** die Stunden stehen je Woche (Vollzeit = 39 h/Woche). Das
  Monats-Soll leitet die App je Monat ab: `Wochenstunden × offene Tage ÷ 6`
  (sechs offene Tage die Woche, Di–So). Eingegeben und angezeigt wird in
  Wochenstunden (`weeklyHours`, siehe `contract.ts`).
- **Eine feste Frühschicht:** eine Kraft arbeitet nur **6:30–14:30** (Vorbereitung
  ab vor Ladenöffnung). Angehakt je Person (`fixedShift`); die App legt für sie
  nur Dienste in genau diesem Fenster an. Da ein fester Dienst nicht gekürzt
  werden kann, trifft er das Monats-Soll best effort – ein kleiner Rest bleibt
  und wird als Warnung gemeldet.
- **Stoßzeit 18:00–20:00** an jedem Öffnungstag (mindestens 2 Personen, keine
  Obergrenze). **Sonntagmittag 12:00–14:00** zusätzlich stark; sonst ist mittags
  wenig los.
- **Freitag, Samstag, Sonntag** machen etwa das Anderthalbfache Umsatz eines
  normalen Tages (`DAY_WEIGHTS` = 1,5; übrige Tage 1,0).
- **Pause nach § 4 ArbZG**: über 6 h = 30 Min, über 9 h = 45 Min.
- **Urlaub** je Person im Tab *Nhân viên* (Arbeitstage, § 3 BUrlG; über dem
  Jahresanspruch nur eine Warnung).
- Belegschaft laut Angabe: **12 Personen** (Wochenstunden). Mitten im Monat
  startende/wechselnde Verträge (ab 7.9., ab 10.9., ab Oktober) trägt der
  Betrieb je Monat ein; ein Teilmonat wird über Urlaubstage vor dem Start
  abgebildet.

> **Annahmen, die der Betrieb noch bestätigen sollte.** Die Personenzahl je
> Stoßzeit (mindestens 2), das Sonntagsmittags-Fenster (12–14) und die
> Zuordnung der festen Frühschicht zu einer konkreten Person sind Annahmen und
> stehen an je einer Stelle im Code.

Web-App zur **automatischen Erstellung monatlicher Dienstpläne** und **druckbarer
deutscher Stundenzettel** für ein Restaurant / Geschäft in Deutschland.

- Kein eigener Server, kein Solver, kein KI-Modell.
- Deterministischer, heuristischer Greedy-Algorithmus.
- Der Plan trifft **jedes monatliche Soll exakt** und lässt sich anschließend
  manuell bearbeiten.
- Persistenz: **LocalStorage** als Offline-Puffer, zusätzlich **Supabase**
  (`store_data`), sofern `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`
  gesetzt sind. Alle Filialen teilen sich eine Tabelle und werden nur über
  `STORE_ID` getrennt (siehe `src/lib/supabase.ts`) – diese Kennung MUSS je
  Repo eindeutig sein.
- Einfache Passwortsperre im Client (`src/lib/auth.ts`), keine echte
  Zugriffskontrolle.

## Tech-Stack

React · TypeScript · Vite · Tailwind CSS · date-fns · Browser-Druck (PDF) ·
LocalStorage · Vitest.

## Installation & Start

```bash
npm install
npm run dev
```

Die App läuft danach unter der von Vite angezeigten URL (Standard
`http://localhost:5173`).

## Weitere Befehle

```bash
npm run test     # Unit-Tests (Vitest)
npm run build    # Produktions-Build (tsc + vite build)
npm run preview  # Produktions-Build lokal ansehen
```

## Bedienung

1. **Einstellungen** – Firmenname, Anschrift, Monat, Jahr; **Arbeitszeit-Fenster
   je Wochentag + Feiertag** (giờ làm; mehrere Blöcke je Tag möglich,
   **Montag geschlossen**). **Feiertage (Bayern)** werden automatisch erkannt
   und angezeigt. Unter **„Ngày đặc biệt"** lassen sich einzelne Tage
   überschreiben (geschlossen oder abweichende Zeiten, z.B. halber Tag).
2. **Mitarbeiter** – Vollzeit/Teilzeit und monatliche Sollstunden pflegen
   (Feld „Giờ định mức"); daneben steht, in wie viele Dienste sich das Soll
   zerlegen lässt.
3. **Dienstplan** – **„Dienstplan erstellen"** generiert den Monatsplan.
   Zellen sind anklickbar: Zeiten/Pause ändern, als *Frei* markieren,
   Schicht verschieben, hinzufügen, löschen. **„Auf Original zurücksetzen"**
   stellt den zuletzt generierten Plan wieder her. **CSV-Export** verfügbar.
4. **Stundenzettel** – druckbarer A4-Zettel je Mitarbeiter,
   einzeln oder alle (über den Druckdialog als PDF speichern).

## Geschäftsregeln (Kurzfassung)

Maßgeblich ist immer der Code; die Doku-Tabellen in der App (Tab **Tài liệu**)
werden direkt aus den Konstanten gerendert und können daher nicht veralten.

- Max. **9 bezahlte Stunden** pro Tag. **Geteilte Dienste sind erlaubt**: eine
  Person darf mittags UND abends arbeiten – höchstens ein Dienst je
  Öffnungsblock, und zwei Dienste dürfen sich nie überschneiden. Die alte Regel
  "ein Dienst pro Tag" stammt aus einer Filiale ohne Mittagsschließung; hier
  drückte sie die Monatsdecke auf 161 h, obwohl im Laden längst mittags und
  abends gearbeitet wird.
  - Die LÜCKE zwischen zwei Diensten wird so klein wie möglich gehalten
    (`tightenSplitShifts`) – im Normalfall genau die Schließzeit. Ohne das
    entstand 11:30–14:30 und dann erst 19:00–22:00: sechs bezahlte Stunden, für
    die jemand von halb zwölf bis zehn im Dienst ist, mit zwei Wegen. Nur wenn
    das engere Rücken die Stoßzeit schlechter besetzt, bleibt die Lücke.
- Höchstens **6 aufeinanderfolgende** Arbeitstage.
- **Pause** (`calculatePause`) nach § 4 ArbZG: über 6 h = 30 Min, über 9 h =
  45 Min. Das ArbZG ist Bundesrecht und gilt überall gleich.
  `presence = paid + pause`.
- Schichtlängen: **3 bis 9 Stunden**. Vollzeit bekommt 4..9 h, Teilzeit 3..9 h.
  Etwa jede zehnte Schicht wird bewusst auf 4–5 h gekürzt
  (`SHORT_SHIFT_CHANCE`), damit die Pläne nicht mechanisch aussehen – aber nur,
  wenn der Tag keinen langen Dienst mehr für die Stoßzeit braucht.
- **Stoßzeiten** (`PEAK_WINDOWS_BY_WEEKDAY`, je Wochentag verschieden):
  Abendspitze **18:00–20:00** an jedem Öffnungstag (mindestens 2 Personen, keine
  Obergrenze), am Sonntag zusätzlich die Mittagsspitze **12:00–14:00**. Geprüft
  wird über die **ganze Spanne**, nicht an einem einzelnen Zeitpunkt.
  - Die Obergrenze greift schon bei der **Wahl der Schichtlänge**
    (`peakLengthCapHours`), nicht erst beim Anordnen: ein 9-h-Dienst hat in
    einem 9-h-Fenster genau **eine** mögliche Lage, drei davon lassen sich
    durch kein Umsortieren mehr entzerren.
  - `repairPeakExcess` tauscht danach noch Termine (die Dauer bleibt bei der
    Person, das Monats-Soll also unangetastet), solange das die Lage
    verbessert.
  - Bleibt trotzdem ein Tag übrig, ist der Plan gültig; das Dashboard weist ihn
    als Warnung aus (`analyzeSchedule.peakViolations`).
- Nachfrage-Gewichte pro Wochentag (`DAY_WEIGHTS`) → mehr Stunden zum
  **Wochenende** hin. Der Ausschlag ist bewusst flach: mehr Stunden helfen
  nichts, wo ohnehin nur zwei Leute stehen dürfen. **Feiertage zählen wie
  Sonntag** (Nachfrage + Zeitfenster).
- **Arbeitszeit-Fenster je Tag** (giờ làm): Früh am Fenster-Beginn, Spät am
  Fenster-Ende. Geschlossene Tage bekommen keine Schicht; an verkürzten Tagen
  werden nur passende (kurze) Schichten geplant. Reicht das nicht, um beide
  Stoßzeiten zu decken, ordnet `layoutDayForPeaks` die Dienste innerhalb des
  Fensters neu an – Dauer und Pause bleiben dabei unverändert.
- **Sollstunden pflegt der Betrieb selbst** (Tab *Nhân viên*, Feld
  „Giờ định mức"). Ein Soll unter der kürzesten Schicht (3 h) ist nicht
  planbar und wird mit einer eigenen Meldung abgelehnt.

## Projektstruktur

```
src/
  types.ts                 zentrale Typen (intern immer Minuten als Integer)
  lib/
    time.ts                timeToMinutes, minutesToTime, calculatePause, ...
    shifts.ts              Schicht-Vorlagen (Früh/Spät)
    demand.ts              Tagesgewichte, Spätschicht-Quoten, Kalender
    splitTargetHours.ts    Zerlegung des Solls in Schichtlängen (DP)
    consecutive.ts         Ketten aufeinanderfolgender Tage, seeded RNG
    workHours.ts           Öffnungs-BLÖCKE je Tag (mehrere möglich) + Overrides
    holidays.ts            Bayerische Feiertage (Osterformel/Computus)
    scheduler.ts           Greedy-Scheduler, Reparaturlauf, Stoßzeiten-Layout
    validation.ts          Prüfung aller Regeln
    analyze.ts             Auswertung: Stoßzeiten, Gewichtstreue, Abweichung
    storage.ts             LocalStorage
    supabase.ts            Client + STORE_ID dieser Filiale
    remote.ts              Laden/Speichern in store_data
    auth.ts                Passwortsperre (nur clientseitig)
    company.ts             Firmenname und Anschrift (fest)
    pdf.ts                 Druck/PDF des Stundenzettels
    sampleData.ts          Beispielbelegschaft (August 2026) – nur für Tests
    seedData.ts            drei Monate mit wechselnden Belegschaften (Tests)
    shiftOps.ts            manuelles Bearbeiten von Schichten
    dateFormat.ts          deutsche Monatsnamen / Formatierung
    __tests__/             Unit-Tests
  hooks/useSchedule.ts     zentrales State-Management + Persistenz
  components/              UI (Einstellungen, Mitarbeiter, Dienstplan, Stundenzettel)
```

## Tests

Getestet werden u. a. `timeToMinutes`, `minutesToTime`, `calculatePause`,
`calculatePaidMinutes`, `splitTargetHours`, die Berechnung aufeinanderfolgender
Tage und die Monats-Validierung.

`seedMonths.test.ts` fährt den Scheduler gegen **drei Monate mit
unterschiedlichen Belegschaften** und prüft: jedes Einzelsoll exakt, höchstens
6 Tage am Stück, Schichtlängen 3..9 h mit passender Pause, keine Schicht
außerhalb des Fensters – und beide Stoßzeiten durchgehend doppelt besetzt.
Diese letzte Prüfung gibt es doppelt: einmal über `minCoverageOver`, einmal als
stumpfe Gegenprobe, die **jede Minute einzeln nachzählt**. Wäre die Abtastung
falsch, meldete die Auswertung sonst fälschlich „alles grün".

`guards.test.ts` deckt die zwei Fälle ab, die der Betrieb durch eigene Eingaben
auslöst: ein Soll unter 3 h (eigene Fehlermeldung statt Kapazitäts-Vortrag) und
eine zu dünne Belegschaft (Plan bleibt korrekt, Lücken werden gemeldet).

Der Report in `seedMonths.test.ts` schreibt zusätzlich Schichtlängen-Verteilung,
Gewichtstreue je Wochentag und die Abweichung vom Tages-Soll auf die Konsole.

## Hinweise / Grenzen (MVP)

- Sollstunden aktuell in **ganzen Stunden**, mindestens 3 h.
- `Schedule` hält immer **genau einen Monat**. Es gibt kein Archiv über
  mehrere Monate; ein Monatswechsel ersetzt den Stand.
- Schicht-Vorlagen sind exakt vorgegeben für 10:00–22:00 und nur für
  pausenfreie Längen; sonst werden Früh-/Spät-Zeiten generisch abgeleitet.
- Der Plan ist „operativ plausibel", nicht mathematisch optimal. Die mittlere
  Abweichung vom rechnerischen Tages-Soll liegt in den Testmonaten bei 1–2 %.
