import { GENDER_LABELS, duplicateCount, vnDateTime } from "./crm";
import { getLeadStatus } from "./status";
import type { Lead, LeadStatusRow } from "./types";

const header = (value: string) => ({ value, fontWeight: "bold" as const });

/** Tra tên theo id cho các cột nguồn / sale (lấy từ danh mục đang tải trên màn hình). */
export type LeadNameLookup = {
  channel: (id: string | null) => string | undefined;
  page: (id: string | null) => string | undefined;
  service: (id: string | null) => string | undefined;
  post: (id: string | null) => string | undefined;
  staff: (id: string | null) => string | undefined;
};

/** Xuất bảng Lead (đúng các cột trên màn hình) ra file .xlsx và mở hộp thoại lưu file của trình duyệt. */
export async function exportLeadsToExcel(
  leads: Lead[],
  fileName: string,
  statuses: LeadStatusRow[],
  names: LeadNameLookup,
) {
  // Chỉ tải thư viện khi người dùng bấm "Tải Excel".
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const statusName = new Map(statuses.map((s) => [s.id, s.name]));
  const status = (l: Lead) =>
    l.status_id ? (statusName.get(l.status_id) ?? "") : l.status !== "so_moi" ? getLeadStatus(l.status).label : "";
  const s = (value: string | null | undefined) => ({ value: value ?? "", type: String });
  const n = (value: number | null | undefined) => (value == null ? { value: "" } : { value, format: "#,##0" });

  const columns = [
    { header: header("STT"), width: 6, cell: (_: Lead, i: number) => ({ value: i + 1 }) },
    { header: header("NGÀY"), width: 12, cell: (l: Lead) => s(vnDateTime(l.created_at)?.day) },
    { header: header("Giờ ra số"), width: 9, cell: (l: Lead) => s(vnDateTime(l.created_at)?.time) },
    { header: header("TÊN KH"), width: 24, cell: (l: Lead) => s(l.full_name) },
    // Ép kiểu chuỗi để Excel không cắt mất số 0 đầu của số điện thoại.
    { header: header("DATA"), width: 14, cell: (l: Lead) => s(l.phone) },
    { header: header("Lưu ý"), width: 30, cell: (l: Lead) => s(l.note) },
    { header: header("BÀI CHẠY"), width: 24, cell: (l: Lead) => s(names.post(l.ad_post_id)) },
    { header: header("DỊCH VỤ"), width: 18, cell: (l: Lead) => s(names.service(l.service_id) ?? l.service) },
    { header: header("PAGE"), width: 18, cell: (l: Lead) => s(names.page(l.page_id)) },
    { header: header("NGUỒN"), width: 12, cell: (l: Lead) => s(names.channel(l.channel_id) ?? l.source) },
    { header: header("TRÙNG"), width: 8, cell: (l: Lead) => n(duplicateCount(l) || null) },
    { header: header("SALE"), width: 18, cell: (l: Lead) => s(l.assignee) },
    { header: header("ĐẢO SỐ"), width: 18, cell: (l: Lead) => s(l.transfer_count > 0 ? `từ ${names.staff(l.previous_assignee_id) ?? "?"} (${l.transfer_count} lần)` : "") },
    { header: header("TÌNH TRẠNG"), width: 16, cell: (l: Lead) => s(status(l)) },
    { header: header("LỊCH HẸN"), width: 16, cell: (l: Lead) => { const d = vnDateTime(l.appointment_at); return s(d ? `${d.day} ${d.time}` : ""); } },
    { header: header("DOANH SỐ"), width: 14, cell: (l: Lead) => n(l.deal_amount) },
    { header: header("DOANH THU"), width: 14, cell: (l: Lead) => n(l.paid_amount) },
    { header: header("KHU VỰC"), width: 14, cell: (l: Lead) => s(l.area) },
    { header: header("Giới Tính"), width: 9, cell: (l: Lead) => s(l.gender ? GENDER_LABELS[l.gender] : "") },
    { header: header("TUỔI"), width: 6, cell: (l: Lead) => n(l.age) },
    { header: header("NGÂN SÁCH"), width: 14, cell: (l: Lead) => s(l.budget) },
    { header: header("NHẬT KÝ TƯ VẤN"), width: 50, cell: (l: Lead) => s(l.consult_info) },
  ];

  const data = [
    columns.map((c) => c.header),
    ...leads.map((lead, i) => columns.map((c) => c.cell(lead, i))),
  ];
  const sheets = [{ sheet: "Lead", data, columns: columns.map((c) => ({ width: c.width })), stickyRowsCount: 1 }];
  await writeExcelFile(sheets as unknown as Parameters<typeof writeExcelFile>[0]).toFile(fileName);
}
