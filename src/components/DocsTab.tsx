import {
  DAY_WEIGHTS,
  WEEKDAY_LABELS_VI,
  type WeekdayKey,
} from "../lib/demand";
import { PEAK_WINDOWS_BY_WEEKDAY } from "../lib/scheduler";
import { CLOSING_MAX, CLOSING_MIN, CLOSING_START } from "../lib/staffing";
import { SHIFT_LENGTHS } from "../lib/shifts";
import { calculatePause, minutesToTime, presenceFromPaid } from "../lib/time";

const WEEKDAY_ORDER: WeekdayKey[] = [
  "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="mb-2 text-base font-semibold text-slate-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function WeekdayTable() {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            {WEEKDAY_ORDER.map((key) => (
              <th key={key} className={`border border-slate-200 px-3 py-1 font-medium ${DAY_WEIGHTS[key] > 1 ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-600"}`}>
                {WEEKDAY_LABELS_VI[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {WEEKDAY_ORDER.map((key) => (
              <td key={key} className="border border-slate-200 px-3 py-1 text-center font-semibold">
                {DAY_WEIGHTS[key].toFixed(1).replace(".", ",")}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PeakTable() {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[700px] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-slate-600">
            <th className="border border-slate-200 px-3 py-1">Ngày</th>
            <th className="border border-slate-200 px-3 py-1">Khung kiểm tra</th>
            <th className="border border-slate-200 px-3 py-1">Mục tiêu</th>
          </tr>
        </thead>
        <tbody>
          {WEEKDAY_ORDER.filter((key) => PEAK_WINDOWS_BY_WEEKDAY[key].length > 0).flatMap((key) =>
            PEAK_WINDOWS_BY_WEEKDAY[key].map((peak) => (
              <tr key={`${key}-${peak.label}-${peak.startMinutes}`}>
                <td className="border border-slate-200 px-3 py-1">{WEEKDAY_LABELS_VI[key]}</td>
                <td className="border border-slate-200 px-3 py-1">{peak.label}: {minutesToTime(peak.startMinutes)}–{minutesToTime(peak.endMinutes)}</td>
                <td className="border border-slate-200 px-3 py-1">{peak.minStaff}–{peak.maxStaff === Infinity ? "∞" : peak.maxStaff} người</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function DocsTab() {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-lg bg-slate-900 p-4 text-white sm:p-5">
        <h1 className="text-lg font-semibold">Tài liệu — nguyên tắc xếp lịch</h1>
        <p className="mt-1 text-sm text-slate-300">
          Các mục dưới đây tách rõ điều kiện bắt buộc, mục tiêu lập kế hoạch và giới hạn thực tế.
        </p>
      </div>

      <Section title="Điều kiện bắt buộc">
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Thứ Hai đóng cửa.</b> Nếu trùng ngày lễ, hiện vẫn giữ đóng cửa theo quy tắc Thứ Hai. Cách xử lý này còn chờ xác nhận; ngày có override giờ riêng được mở.</li>
          <li><b>T3–T7:</b> 10:30–14:30 và 16:30–22:30. <b>CN/ngày lễ được mở:</b> 10:30–22:00 liên tục.</li>
          <li>Trong toàn bộ mỗi khung mở cửa phải có <b>ít nhất 2 người thực làm</b>. Chủ nhật áp dụng liên tục 10:30–22:00; người đang pause không được tính.</li>
          <li>Từ <b>21:30 đến giờ đóng cửa</b> cần <b>5–6 người</b>. Đây là số người làm việc thực tế, không tính người đang nghỉ.</li>
          <li>Cao điểm khách hàng: <b>18:00–20:00</b>; CN thêm <b>12:00–14:00</b>. Số người lập kế hoạch bên dưới là mức vận hành do code suy ra, không phải số khách hàng đã được người dùng chốt.</li>
          <li>Hợp đồng tuần là <b>giới hạn cứng</b>; không mượn giờ giữa ISO-week. Tối đa 6 ngày liên tiếp, tôn trọng ngày được làm và các ngày nghỉ đã nhập.</li>
          <li>Mỗi ca nằm gọn trong một khung mở; ca gãy không chồng giờ. Pauses phải có thời điểm bắt đầu rõ ràng để loại người đó khỏi coverage trong đúng khoảng nghỉ.</li>
        </ul>
      </Section>

      <Section title="Khung giờ và mục tiêu nhân sự">
        <p>
          Các cửa sổ hiển thị dưới đây lấy trực tiếp từ cấu hình lập lịch. <b>2 người suốt giờ mở cửa</b> và
          <b>5–6 người lúc đóng</b> là yêu cầu vận hành. Mức tối thiểu cao điểm
          <b>4 ngày thường, 6 ngày bận (T6–CN)</b> và <b>6 CN/ngày lễ ở khung trưa</b> là
          <b>planning target</b> được suy ra từ baseline 4 × trọng số ngày; không phải yêu cầu khách hàng độc lập.
        </p>
        <PeakTable />
        <p className="text-slate-600">
          Báo cáo dùng chính thời gian, min/max, actual staff và trạng thái của từng cửa sổ.
          Thiếu người hoặc vượt giới hạn phải hiện rõ; “lịch đã tạo” không đồng nghĩa mọi mục tiêu đã đạt.
        </p>
      </Section>

      <Section title="Nhu cầu: 1,5 là mục tiêu theo tuần">
        <p>
          <b>T6, T7, CN = 1,5</b>; ngày thường = 1,0. Hệ số mô tả nhu cầu tương đối.
          Chuẩn hóa trong từng ISO-week theo số giờ thực tế có thể phân bổ:
        </p>
        <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-xs text-slate-800">{`Tagesziel = Stunden der Woche × Gewicht des Tages
           ÷ Summe der Gewichte der geöffneten Tage`}</pre>
        <WeekdayTable />
        <p>
          Báo cáo chỉ tính ratio T6–CN so với T3–T5 cho tuần đầy đủ, tránh kết luận sai ở tuần đầu/cuối tháng.
          Ngày lễ dùng khung CN khi được mở. Tỷ lệ đúng 1,5 không được đảm bảo vì hợp đồng tuần,
          availability, pauses, số người tối thiểu và lưới giờ có thể xung đột.
        </p>
        <p className="text-slate-600">
          Fulltime 39 giờ/tuần ưu tiên mẫu thứ cố định, khoảng 6–7 giờ/ngày và thường 6 ngày/tuần.
          Một mẫu đều 6,5 giờ mỗi ngày lại triệt tiêu chênh lệch nhu cầu; ưu tiên này vì thế là mềm,
          còn hợp đồng và giới hạn nhân sự là cứng.
        </p>
      </Section>

      <Section title="Laca và pauses">
        <p>
          Laca vẫn <b>chưa gán cho ai</b> theo yêu cầu “không cần”. Không suy đoán danh tính,
          không đổi hợp đồng 40 giờ hiện có. Khi người dùng tự chọn <code>fixedShift</code>, cửa sổ là
          <b>06:30–14:30</b> và không được tự cắt ngắn.
        </p>
        <p>
          Pause là khoảng thời gian cụ thể trong ca: trên 6 giờ công cần 30 phút, trên 9 giờ cần 45 phút.
          Khoảng pause kéo dài thời gian có mặt nhưng không tính vào giờ công:
        </p>
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead><tr className="bg-slate-50"><th className="border border-slate-200 px-3 py-1">Giờ công</th><th className="border border-slate-200 px-3 py-1">Pause</th><th className="border border-slate-200 px-3 py-1">Có mặt</th></tr></thead>
            <tbody>{SHIFT_LENGTHS.map((hours) => (
              <tr key={hours}>
                <td className="border border-slate-200 px-3 py-1">{hours}h</td>
                <td className="border border-slate-200 px-3 py-1">{calculatePause(hours * 60)}′</td>
                <td className="border border-slate-200 px-3 py-1">{(presenceFromPaid(hours * 60) / 60).toFixed(2).replace(".", ",")}h</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="text-slate-600">
          Với Laca 8 giờ có mặt và 30 phút pause, phần công là 7,5 giờ. Năm ca = 37,5 giờ,
          sáu ca = 45 giờ; riêng hợp đồng 39 giờ không thể vừa giữ cửa sổ nguyên vẹn vừa đạt chính xác.
          Phần thiếu/thừa phải báo cáo, không sửa thầm hợp đồng.
        </p>
      </Section>

      <Section title="Ngày đặc biệt và kiểm tra">
        <ul className="list-disc space-y-1 pl-5">
          <li>Override có thể đóng một ngày hoặc đặt một khung giờ riêng. Lịch phải được đánh giá lại sau override.</li>
          <li>Lịch chỉnh tay phải giữ đúng availability, hợp đồng tuần, tối đa 6 ngày liên tiếp, khung ca, pause và coverage.</li>
          <li>StaffingReport phân biệt <b>actual</b>, <b>target</b>, giới hạn bắt buộc và cảnh báo. Không dùng màu làm tín hiệu duy nhất.</li>
        </ul>
      </Section>

      <Section title="Giới hạn cần biết">
        <p>
          Đây là heuristic, không phải solver tối ưu toàn cục. Tổ hợp hợp đồng, 1,5 demand objective,
          mẫu fulltime, fixed shift, availability, 2 người suốt giờ mở cửa và 5–6 người lúc đóng có thể không tồn tại.
          Khi không tồn tại, lịch phải giữ phần đạt được và báo rõ lý do.
        </p>
        <p className="text-slate-600">
          Giờ đóng chuẩn là {minutesToTime(CLOSING_START)}–22:30 và mục tiêu là {CLOSING_MIN}–{CLOSING_MAX} người.
          Các con số khác trong báo cáo là kết quả thực tế của lịch, không phải cam kết.
        </p>
      </Section>

      <Section title="Cách dùng">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Kiểm tra giờ mở, ngày lễ và override trong <b>Cài đặt</b>.</li>
          <li>Kiểm tra weekly contract, availability và Laca trong <b>Nhân viên</b>; Laca chưa có người.</li>
          <li>Tạo lịch, đọc <b>StaffingReport</b> cùng cảnh báo hợp đồng trước khi in.</li>
          <li>Sau khi sửa tay, kiểm tra lại toàn bộ report rồi mới dùng bản in.</li>
        </ol>
      </Section>
    </div>
  );
}
