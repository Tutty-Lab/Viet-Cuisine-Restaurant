// ============================================================================
// Beschriftungen der Anstellungsarten – an einer Stelle, damit eine neue Art
// nicht in fünf Komponenten einzeln nachgetragen werden muss.
// ============================================================================

import type { EmploymentType } from "../types";

/** Volle Bezeichnung in der App-Sprache (Vietnamesisch). */
export function employmentLabelVi(type: EmploymentType): string {
  switch (type) {
    case "VOLLZEIT":
      return "Toàn thời gian";
    case "TEILZEIT":
      return "Bán thời gian";
    case "MINIJOB":
      return "Minijob";
    case "AZUBI":
      return "Học nghề";
    case "AZUBI":
      return "Học nghề";
  }
}

/** Kürzel für die enge Spalte im Dienstplan-Raster. */
export function employmentShortVi(type: EmploymentType): string {
  switch (type) {
    case "VOLLZEIT":
      return "TT";
    case "TEILZEIT":
      return "BT";
    case "MINIJOB":
      return "MJ";
    case "AZUBI":
      return "HN";
  }
}

/** Deutsche Bezeichnung – so steht sie auf dem Stundenzettel. */
export function employmentLabelDe(type: EmploymentType): string {
  switch (type) {
    case "VOLLZEIT":
      return "Vollzeit";
    case "TEILZEIT":
      return "Teilzeit";
    case "MINIJOB":
      return "Minijob";
    case "AZUBI":
      return "Auszubildender";
  }
}
