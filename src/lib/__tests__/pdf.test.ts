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

describe("deliver", () => {
  it("tải file trực tiếp qua thẻ a với download attribute và MIME octet-stream", async () => {
    const { deliver } = await import("../pdf");
    const blob = new Blob(["%PDF-dummy"], { type: "application/pdf" });
    let createdUrl = "";
    let clickedDownload = "";
    let clickedRel = "";
    let blobType = "";

    const originalDocument = (globalThis as any).document;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    const mockAnchor = {
      href: "",
      download: "",
      rel: "",
      style: {} as any,
      click: () => {},
    };

    const mockBody = {
      appendChild: (node: any) => {
        clickedDownload = node.download;
        clickedRel = node.rel;
        return node;
      },
      removeChild: (node: any) => node,
      contains: () => true,
    };

    (globalThis as any).document = {
      createElement: (tag: string) => {
        if (tag === "a") return mockAnchor;
        return {};
      },
      body: mockBody,
    };

    URL.createObjectURL = (b: Blob) => {
      blobType = b.type;
      createdUrl = "blob:http://localhost/test-uuid";
      return createdUrl;
    };
    URL.revokeObjectURL = () => {};

    try {
      await deliver(blob, "Stundenzettel_Tuan.pdf");

      expect(blobType).toBe("application/octet-stream");
      expect(clickedDownload).toBe("Stundenzettel_Tuan.pdf");
      expect(clickedRel).toBe("noopener");
    } finally {
      (globalThis as any).document = originalDocument;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });
});
