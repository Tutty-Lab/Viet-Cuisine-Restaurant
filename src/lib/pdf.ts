// ============================================================================
// PDF-Export der Stundenzettel. Jede .stundenzettel-page wird als Bild
// aufgenommen und auf eine A4-Seite gelegt – dadurch sieht die PDF exakt so
// aus wie der Ausdruck, ohne das Layout ein zweites Mal pflegen zu müssen.
// ============================================================================

import { jsPDF } from "jspdf";
// html2canvas-pro (Fork) statt html2canvas: der alte Parser wirft bei modernen
// Farbfunktionen wie oklch()/color-mix() einen Fehler ("unsupported color
// function"). Solche Farben stammen oft von Browser-Erweiterungen (z. B. Dark
// Reader), die ihre Styles in die Seite einschleusen; html2canvas klont sie
// beim Aufnehmen mit und scheitert. Der Fork versteht diese Funktionen.
import html2canvas from "html2canvas-pro";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

/** Dateiname säubern: Umlaute/Akzente weg, nur unbedenkliche Zeichen behalten. */
export function safeFileName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Akzente entfernen: "Tuấn" -> "Tuan"
    .replace(/đ/g, "d") // đ
    .replace(/Đ/g, "D"); // Đ
  return plain.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Stundenzettel";
}

/**
 * Rendert die übergebenen Elemente in eine PDF (ein Element = eine A4-Seite)
 * und stößt den Download an. Die Elemente müssen sichtbar gerendert sein –
 * display:none kann html2canvas nicht aufnehmen (deshalb die Offscreen-Bühne).
 */
/** Schriftstapel wie in der App (Tailwind-Sans). Wird beim Klonen erzwungen. */
const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

export async function elementsToPdf(
  elements: HTMLElement[],
  filename: string,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  if (elements.length === 0) return;

  // Schriften ZUERST laden. Sonst nimmt html2canvas eine Seite gelegentlich auf,
  // bevor die Schrift/Styles stehen.
  try {
    await document.fonts?.ready;
  } catch {
    // Ohne Font-Loading-API einfach weiter – dann gilt die Systemschrift.
  }
  // Hai frames + ngắn pause để đảm bảo DOM render hoàn tất
  await nextFrame();
  await nextFrame();
  await sleep(150);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  for (let i = 0; i < elements.length; i++) {
    onProgress?.(i + 1, elements.length);
    const el = elements[i];
    const elWidth = el.scrollWidth || 794;
    const elHeight = el.scrollHeight || 1122;

    const canvas = await html2canvas(el, {
      scale: 2, // Đảm bảo độ sắc nét cao cho văn bản và đường kẻ bảng
      backgroundColor: "#ffffff",
      logging: false,
      width: elWidth,
      height: elHeight,
      windowWidth: elWidth,
      windowHeight: elHeight,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0,
      // Khi clone DOM, cô lập duy nhất trang hiện tại tại gốc body (0, 0) và chèn style viền bảng.
      // Loại bỏ toàn bộ các node khác trong body ảo để không bị lệch trục Y hay xung đột layout.
      onclone: (clonedDoc, clonedEl) => {
        const style = clonedDoc.createElement("style");
        style.textContent = `
          table.stundenzettel-table {
            width: 100% !important;
            border-collapse: separate !important;
            border-spacing: 0 !important;
            border-top: 1.5px solid #475569 !important;
            border-left: 1.5px solid #475569 !important;
          }
          table.stundenzettel-table th,
          table.stundenzettel-table td {
            border-right: 1.5px solid #475569 !important;
            border-bottom: 1.5px solid #475569 !important;
            border-top: none !important;
            border-left: none !important;
            box-sizing: border-box !important;
          }
        `;
        clonedDoc.head.appendChild(style);

        // Tách clonedEl ra an toàn
        clonedEl.remove();

        // Dọn sạch toàn bộ các phần tử khác trong body iframe
        while (clonedDoc.body.firstChild) {
          clonedDoc.body.removeChild(clonedDoc.body.firstChild);
        }

        // Đưa clonedEl về vị trí gốc tuyệt đối (0, 0)
        clonedDoc.body.style.margin = "0";
        clonedDoc.body.style.padding = "0";
        clonedDoc.body.style.background = "#ffffff";
        clonedDoc.body.style.width = `${elWidth}px`;
        clonedDoc.body.style.minWidth = `${elWidth}px`;
        clonedDoc.body.style.overflow = "visible";

        clonedEl.style.position = "static";
        clonedEl.style.margin = "0";
        clonedEl.style.width = `${elWidth}px`;
        clonedEl.style.maxWidth = `${elWidth}px`;
        clonedEl.style.minWidth = `${elWidth}px`;
        clonedEl.style.boxSizing = "border-box";
        clonedEl.style.fontFamily = FONT_STACK;
        clonedEl.style.opacity = "1";
        clonedEl.style.visibility = "visible";

        clonedDoc.body.appendChild(clonedEl);
      },
    });

    // Seitenverhältnis beibehalten und in die A4-Seite einpassen.
    const ratio = canvas.height / canvas.width;
    let width = A4_WIDTH_MM;
    let height = width * ratio;
    if (height > A4_HEIGHT_MM) {
      height = A4_HEIGHT_MM;
      width = height / ratio;
    }

    if (i > 0) doc.addPage();
    doc.addImage(
      canvas.toDataURL("image/jpeg", 0.95),
      "JPEG",
      (A4_WIDTH_MM - width) / 2,
      0,
      width,
      height,
    );

    // Giải phóng ngay bộ nhớ Canvas sau khi ghi trang vào PDF (rất quan trọng trên iOS Safari)
    canvas.width = 0;
    canvas.height = 0;

    // Nghỉ ngắn giữa các trang để giải phóng luồng chính
    await sleep(25);
  }

  await deliver(doc.output("blob"), filename);
}

/**
 * Tải file PDF trực tiếp về máy.
 * Đặt kiểu MIME thành application/octet-stream với tên file .pdf để các trình duyệt
 * (đặc biệt là Safari iOS, Chrome trên iPhone/Android) tự động kích hoạt trình tải file
 * và lưu thẳng vào máy (thư mục Tệp / Downloads) thay vì mở sang link/tab mới.
 */
export async function deliver(blob: Blob, filename: string): Promise<void> {
  if (typeof document === "undefined") return;
  const octetBlob = new Blob([blob], { type: "application/octet-stream" });
  const url = URL.createObjectURL(octetBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  // Dọn dẹp URL sau khi trình duyệt đã tiếp nhận download
  setTimeout(() => {
    if (document.body.contains(a)) {
      document.body.removeChild(a);
    }
    URL.revokeObjectURL(url);
  }, 60_000);
}
