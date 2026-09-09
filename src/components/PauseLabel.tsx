import type { Shift } from "../types";
import { minutesToTime } from "../lib/time";

export function PauseLabel({ shift, language = "vi" }: { shift: Shift; language?: "vi" | "de" }) {
  const label = language === "de" ? "Pause" : "Nghỉ";
  return <span>{label} {shift.pauseMinutes}′{shift.pauseStartMinutes != null && shift.pauseMinutes > 0 &&
    ` (${minutesToTime(shift.pauseStartMinutes)}–${minutesToTime(shift.pauseStartMinutes + shift.pauseMinutes)})`}</span>;
}
