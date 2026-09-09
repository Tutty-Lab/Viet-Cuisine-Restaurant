# Dienstplan & Stundenzettel — Viet Cuisine GmbH

Haupt Straße 11, 92348 Berg (Oberpfalz, Bayern). React-Anwendung für
Wochenplanung innerhalb eines Monats und deutsche Stundenaufzeichnungen.
Die Oberfläche ist auf Vietnamesisch.

## Öffnungszeiten und Besetzung

- **Montag geschlossen, auch an einem Feiertag.** Montagsfeiertage sind nicht
  abschließend geklärt; bis dahin gilt die explizite Montagsschließung.
  Nur eine Datumsausnahme mit eigenen Zeiten öffnet den Tag.
- **Di–Sa:** 10:30–14:30 und 16:30–22:30. Die Mittagsschließung
  14:30–16:30 zählt nicht als Arbeitszeit.
- **Sonntag und geöffnete Feiertage:** durchgehend 10:30–22:00.
  Bayerische Feiertage zählen bei Öffnungsfenster und Nachfrage wie Sonntag;
  Datumsausnahmen haben Vorrang.
- **Während jedes geöffneten Blocks arbeiten mindestens 2 Personen.** Das gilt
  auch nach der Wiederöffnung um 16:30 und sonntags durchgehend.
- **21:30 bis zum tatsächlichen Tagesende: 5–6 arbeitende Personen.**
  Üblicherweise bis 22:30, sonntags und an geöffneten Feiertagen bis 22:00.
- **Betriebliche Stoßzeiten:** 18:00–20:00 sowie sonntags 12:00–14:00.
  Die Planung verwendet abends **4 Personen an normalen Tagen, 6 an starken
  Tagen** und **6 sonntags/feiertags mittags**. Diese Zahlen sind ausdrücklich
  **abgeleitete Planungsziele der Implementierung**, keine vom Kunden genannten
  Personenzahlen für die Stoßzeit.

Die Mindestbesetzung gilt über das jeweilige Prüfintervall, geschnitten mit den
tatsächlich geöffneten Blöcken. Pausierende Personen zählen nicht als arbeitend.
Der Bericht nennt die Prüfzeiten, das Minimum und Maximum der Besetzung sowie
den Vergleichswert.

## Verträge, Wochenmuster und Nachfrage

- **Wochenverträge sind harte Grenzen.** Fehlende Stunden dürfen weder durch
  Überschreiten des Vertrags noch durch Verschieben in eine andere ISO-Woche
  kaschiert werden. ISO-Wochen laufen Montag bis Sonntag; Randwochen zählen
  anteilig. Zusätzliche Öffnungstage erhöhen den Wochenvertrag nicht.
- **39 h/Woche ist der übliche Vollzeitvertrag.** Vorhandene 40-h-Verträge
  bleiben bestehen. Keine automatische Umstellung der Belegschaft.
- **Vollzeit bevorzugt ein wiederkehrendes Muster je Wochentag**, meistens mit
  sechs Arbeitstagen und ungefähr 6–7 h/Tag. Identische 6,5 h an jedem Tag
  liefern jedoch keinen Nachfrageunterschied. Tageslängen und flexible
  Einsätze müssen Spielraum lassen, wenn das Wochenende stärker besetzt sein soll.
- Verfügbare Wochentage, gesperrte Daten, Wochenarbeitstage, höchstens sechs
  aufeinanderfolgende Arbeitstage und zulässige Tagesarbeitszeit begrenzen
  jede Zuteilung. Geteilte Dienste bleiben innerhalb ihrer Öffnungsblöcke
  und dürfen sich nicht überschneiden.

**Freitag, Samstag und Sonntag: Nachfragegewicht 1,5; normale Tage: 1,0.**
Das ist ein Optimierungsziel, keine Garantie für exakt 1,5-mal so viele
Arbeitsstunden. Geschlossene Tage haben kein Gewicht; geöffnete Feiertage zählen
wie Sonntag. Tagesziele werden **je ISO-Woche** auf die tatsächlich erreichbaren,
zugeteilten Stunden normalisiert:

```text
Tagesziel = zugeteilte Stunden dieser Woche × Tagesgewicht
           ÷ Summe der Gewichte ihrer geöffneten Tage
```

Diese Vergleichsziele ersetzen keine Vertragsprüfung: weniger zugeteilte Stunden
senken auch die Vergleichsziele, beseitigen aber kein Vertragsdefizit. Gleiche
6,5 h täglich, exakte Wochenverträge, Verfügbarkeit, Besetzungsgrenzen und ein
striktes Tagesverhältnis von 1,5 sind nicht immer gleichzeitig erfüllbar.
Nicht erreichte Ziele und Besetzungslücken müssen sichtbar bleiben; ein
erzeugter Plan ist keine Zusage, dass alle Vorgaben erfüllt sind.

## Laca und Pausen

Die besondere Frühschicht **06:30–14:30 (Laca)** bleibt **keiner Person
zugeordnet**. Der Nutzer hat keine Zuordnung gewünscht („không cần“).
`fixedShift` beschreibt eine ausdrücklich eingetragene feste Schicht;
die App soll keine Identität aus Namen oder Verträgen ableiten.

Mit 30 Minuten unbezahlter Pause liefert dieses Fenster 7,5 h Arbeitszeit.
Fünf unveränderte Dienste ergeben 37,5 h, sechs ergeben 45 h. Ein Vertrag
von 39 h lässt sich damit allein nicht exakt erreichen. Ein solcher Rest ist
getrennt auszuweisen, ohne Vertragsstunden still zu ändern.

Pausen sind explizite Zeitintervalle innerhalb einer Schicht. Über 6 h bezahlter
Arbeit fallen 30 Minuten Pause an, über 9 h 45 Minuten. Beispiel: 6,5 h Arbeit
plus 30 Minuten Pause bedeuten 7 h Anwesenheit. Keine Arbeitsphase darf länger
als sechs Stunden ohne Pause dauern. Die Mittagsschließung zwischen getrennten
Diensten bleibt unbezahlte Unterbrechung. Alte oder bearbeitete lange Schichten
ohne gültiges Pausenintervall benötigen Prüfung; bloße Anwesenheit ist kein
Nachweis für Besetzung während einer Pause.

## Bericht und Bedienung

1. **Cài đặt:** Monat, Öffnungszeiten und Datumsausnahmen prüfen.
2. **Nhân viên:** bestehende Wochenverträge und Verfügbarkeit prüfen.
   Fehlende Stunden sind kein Anlass, Verträge automatisch umzuschreiben.
3. **Lịch làm việc:** Plan erzeugen, danach Vertragsfehler und Besetzungsbericht
   prüfen. Zeiten, explizite Pausen und manuelle Änderungen beeinflussen die
   Besetzung erneut.
4. **Bảng chấm công:** Stundenaufzeichnungen und Dienstpläne drucken.
   Nach Änderungen an einem bereits gedruckten Stand auch die betroffenen
   Ausdrucke ersetzen.

`StaffingReport` erhält `analysis: ScheduleAnalysis`. Er zeigt je Datum und
Wochentag Zielstunden, zugeteilte Stunden und deren Differenz. Je vollständiger
ISO-Woche vergleicht er die durchschnittlichen Tagesstunden Fr–So mit Di–Do;
Randwochen oder Wochen mit geschlossenen Vergleichstagen erhalten kein
irreführendes Verhältnis. Bei null Stunden im Nenner ist es nicht berechenbar.
Die Zielquote wird aus den Tageszielen gelesen, damit Feiertage berücksichtigt
bleiben. Zusätzlich zeigt jeder Prüfbereich seine Zeiten, Ist-Besetzung,
benötigte Unter-/Obergrenze und Abweichung. Ein erfüllter Prüfbereich ist keine
Bestätigung der gesamten Vertrags- oder Pausenprüfung.

## Entwicklung

React, TypeScript, Vite, Tailwind CSS, date-fns und Vitest; Druck/PDF über Browser
und PDF-Hilfen. Lokaler Start:

```bash
npm install
npm run dev
```

```bash
npm run test
npm run build
npm run preview
```

Persistenz über LocalStorage und optional Supabase (`store_data`), konfiguriert
mit `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`. `STORE_ID` muss je Filiale
eindeutig sein. Die Passwortsperre im Client ersetzt keine Zugriffskontrolle.

Wichtige Module:

- `src/lib/weeklyScheduler.ts`: Wochenzuteilung und Schichtanordnung.
- `src/lib/contract.ts`: Vertragsumrechnung und Wochenquoten.
- `src/lib/workHours.ts`: Öffnungsblöcke, Montagsschließung und Ausnahmen.
- `src/lib/staffing.ts`: Besetzungsfenster, Pausen und gewichtete Tagesziele.
- `src/lib/analyze.ts`: tatsächliche Besetzung und Stundenvergleich.
- `src/lib/validation.ts`: Vertrags- und Schichtprüfung.
- `src/components/StaffingReport.tsx`: Besetzungsbericht aus der Analyse.
- `src/lib/__tests__/`: Regressionstests; Erfolg einzelner Beispiele beweist
  keine allgemeine Lösbarkeit aller möglichen Eingaben.

`Schedule` enthält einen Monat. Verfügbarkeitsengpässe, feste Schichten,
Monatsgrenzen und das Zeitraster können Ziele unerreichbar machen. Reststunden,
Vertragsfehler, Besetzungslücken und Abweichungen vom Nachfrageziel sind getrennt
zu beurteilen. Es gibt keine Garantie für eine global optimale Lösung.
