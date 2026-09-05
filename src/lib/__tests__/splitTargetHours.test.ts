import { describe, expect, it } from "vitest";
import { splitTargetHours } from "../splitTargetHours";

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

describe("splitTargetHours – Vollzeit", () => {
  it("summiert immer exakt auf das Ziel", () => {
    for (let h = 3; h <= 200; h++) {
      const parts = splitTargetHours(h, "VOLLZEIT");
      expect(sum(parts)).toBe(h);
      for (const p of parts) expect(p).toBeGreaterThanOrEqual(3);
      for (const p of parts) expect(p).toBeLessThanOrEqual(9);
    }
  });

  it("bevorzugt die längste Schicht (9 h) und damit möglichst wenige Dienste", () => {
    // 176 = 19×9 + 5
    expect(splitTargetHours(176, "VOLLZEIT")).toEqual([...Array(19).fill(9), 5]);
    // Jedes Ziel wird mit der kleinstmöglichen Schichtzahl abgedeckt:
    // aufgerundet targetHours/9 Dienste.
    for (const h of [176, 178, 179, 180]) {
      const parts = splitTargetHours(h, "VOLLZEIT");
      expect(sum(parts)).toBe(h);
      expect(parts.length).toBe(Math.ceil(h / 9));
    }
  });
});

describe("splitTargetHours – Teilzeit", () => {
  it("summiert exakt und vermeidet 7/8-h-Schichten wo möglich", () => {
    for (const h of [40, 55, 79, 80]) {
      const parts = splitTargetHours(h, "TEILZEIT");
      expect(sum(parts)).toBe(h);
      // keine 7/8-h-Schichten bei diesen Zielen
      expect(parts.every((p) => p <= 6)).toBe(true);
    }
  });

  it("55 = 11×5, 80 = 16×5, 79 = 11×5 + 4×6", () => {
    expect(splitTargetHours(55, "TEILZEIT")).toEqual(Array(11).fill(5));
    expect(splitTargetHours(80, "TEILZEIT")).toEqual(Array(16).fill(5));
    const s79 = splitTargetHours(79, "TEILZEIT").slice().sort((a, b) => a - b);
    expect(s79).toEqual([...Array(11).fill(5), ...Array(4).fill(6)].sort((a, b) => a - b));
  });
});

describe("splitTargetHours – Fehlerfälle", () => {
  it("wirft bei nicht darstellbaren Zielen (1 und 2 h)", () => {
    expect(() => splitTargetHours(1, "VOLLZEIT")).toThrow();
    expect(() => splitTargetHours(2, "TEILZEIT")).toThrow();
    // 3 h ist jetzt darstellbar (eine 3-h-Schicht).
    expect(splitTargetHours(3, "TEILZEIT")).toEqual([3]);
  });
  it("0 => leere Liste", () => {
    expect(splitTargetHours(0, "VOLLZEIT")).toEqual([]);
  });
});
