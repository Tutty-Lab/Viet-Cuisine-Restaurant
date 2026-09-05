import { describe, expect, it } from "vitest";
import { safeFileName } from "../pdf";

describe("safeFileName", () => {
  it("entfernt vietnamesische Akzente", () => {
    expect(safeFileName("Nguyễn Văn Tuấn")).toBe("Nguyen_Van_Tuan");
    expect(safeFileName("Đức")).toBe("Duc");
  });

  it("entfernt deutsche Umlaute und ß-fremde Zeichen", () => {
    expect(safeFileName("Jörg Müller")).toBe("Jorg_Muller");
  });

  it("lässt unbedenkliche Zeichen stehen", () => {
    expect(safeFileName("Mai-2026_08")).toBe("Mai-2026_08");
  });

  it("hat immer einen brauchbaren Rückfallwert", () => {
    expect(safeFileName("   ")).toBe("Stundenzettel");
    expect(safeFileName("///")).toBe("Stundenzettel");
  });
});
