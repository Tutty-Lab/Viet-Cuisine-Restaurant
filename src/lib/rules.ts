// ============================================================================
// Welche Regeln HART sind und welche WEICH – eine Liste für Anzeige, Prüfung
// und Vorschläge.
//
// Luật cứng: der Planer bricht sie nie. Steht trotzdem etwas im Plan, das sie
// verletzt (Hand-Änderung, unmögliche Vorgabe), ist das ein Fehler.
// Luật mềm: der Planer versucht es; geht es nicht, bleibt der Plan brauchbar,
// die Abweichung wird gemeldet und „Tìm cách xếp khác" sucht eine Änderung.
// ============================================================================

export type RuleKind = "hard" | "soft";

export type RuleId =
  // hart
  | "open-hours"
  | "closing"
  | "shift-length"
  | "max-days"
  | "days-off"
  | "employment-period"
  | "two-stores"
  | "contract-max"
  | "fixed-shift"
  | "holiday-duty"
  // weich
  | "contract-hours"
  | "peak-staff"
  | "day-weights"
  | "own-shift-length"
  | "spread-evenly"
  | "preferred-windows";

export type Rule = { id: RuleId; kind: RuleKind; title: string; detail: string };

export const RULES: readonly Rule[] = [
  { id: "open-hours", kind: "hard", title: "Chỉ trong giờ mở cửa", detail: "Ngày quán đóng cửa và giờ nghỉ trưa không xếp ca." },
  { id: "closing", kind: "hard", title: "Đủ người suốt giờ mở", detail: "Suốt giờ mở luôn có ít nhất 2 người; từ 21:30 tới đóng cửa ít nhất 3 người." },
  { id: "shift-length", kind: "hard", title: "Ca 3–9 giờ, nghỉ đúng luật", detail: "Mỗi ca ít nhất 3 giờ, tối đa 9 giờ công một ngày; giờ nghỉ theo luật lao động." },
  { id: "max-days", kind: "hard", title: "Tối đa 6 ngày liên tiếp", detail: "Không vượt 6 ngày liên tiếp và không vượt „Số ngày làm / tuần\" đã đặt." },
  { id: "days-off", kind: "hard", title: "Ngày nghỉ cố định", detail: "Không xếp ca vào ngày nghỉ cố định của người đó." },
  { id: "employment-period", kind: "hard", title: "Ngày vào làm / nghỉ việc", detail: "Không xếp ca trước ngày vào làm hoặc sau ngày nghỉ việc." },
  { id: "two-stores", kind: "hard", title: "Không làm 2 quán cùng ngày", detail: "Người làm nhiều quán chỉ được xếp một quán mỗi ngày." },
  { id: "contract-max", kind: "hard", title: "Không quá giờ hợp đồng", detail: "Không xếp quá giờ tháng (hoặc giờ tuần với hợp đồng theo tuần)." },
  { id: "fixed-shift", kind: "hard", title: "Ca cố định", detail: "Người có ca cố định chỉ làm đúng khung giờ đó." },
  { id: "holiday-duty", kind: "hard", title: "Trực ngày lễ", detail: "Ngày lễ quán mở thì người trực ngày lễ phải có ca." },
  { id: "contract-hours", kind: "soft", title: "Đủ giờ định mức", detail: "Xếp đủ giờ hợp đồng; tháng không đủ ngày (nghỉ, giới hạn ngày, làm quán khác) thì báo thiếu." },
  { id: "peak-staff", kind: "soft", title: "Số người giờ cao điểm", detail: "Tối 18–20h 4 người (T6–CN 6); trưa CN/lễ 12–14h 6 người – đông hơn thì không sao." },
  { id: "day-weights", kind: "soft", title: "Ngày đông nhiều giờ hơn", detail: "T6, T7, CN và ngày lễ (hệ số 1,5) nhận nhiều giờ hơn T3–T5." },
  { id: "own-shift-length", kind: "soft", title: "Độ dài ca riêng", detail: "Mỗi ngày làm nằm trong khoảng giờ đã đặt cho người đó." },
  { id: "spread-evenly", kind: "soft", title: "Rải đều trong tháng", detail: "Giờ chia đều theo tuần; có Độ dài ca thì nhiều ca ngắn hơn." },
  { id: "preferred-windows", kind: "soft", title: "Khung giờ ưu tiên", detail: "Xếp vào ngày và giờ người đó muốn, nếu số người và giờ định mức cho phép." },
];

export const ruleById = (id: RuleId): Rule => RULES.find((r) => r.id === id)!;

/** Besetzungsregeln (staffing.ts) nach Label: welche hart, welche weich. */
export function staffingRuleId(label: string): RuleId {
  return label === "Trưa CN" || label === "Tối" ? "peak-staff" : "closing";
}
