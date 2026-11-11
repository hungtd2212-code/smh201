import { format } from "date-fns";
import { getLeadStatus } from "./status";
import type { Lead } from "./types";

const header = (value: string) => ({ value, fontWeight: "bold" as const });

const dateTime = (iso: string | null) =>
  iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "";

/** Xuất danh sách lead ra file .xlsx và mở hộp thoại lưu file của trình duyệt. */
export async function exportLeadsToExcel(leads: Lead[], fileName: string) {
  // Chỉ tải thư viện khi người dùng bấm "Tải Excel".
  const { default: writeExcelFile } = await import("write-excel-file/browser");

  const columns = [
    { header: header("Ngày tạo"), width: 18, cell: (l: Lead) => ({ value: dateTime(l.created_at) }) },
    { header: header("Khách hàng"), width: 26, cell: (l: Lead) => ({ value: l.full_name }) },
    // Ép kiểu chuỗi để Excel không cắt mất số 0 đầu của số điện thoại.
    { header: header("Số điện thoại"), width: 16, cell: (l: Lead) => ({ value: l.phone, type: String }) },
    { header: header("Dịch vụ"), width: 20, cell: (l: Lead) => ({ value: l.service ?? "" }) },
    { header: header("Nguồn"), width: 16, cell: (l: Lead) => ({ value: l.source ?? "" }) },
    { header: header("ID Ads"), width: 14, cell: (l: Lead) => ({ value: l.ads_id ?? "", type: String }) },
    { header: header("Trạng thái"), width: 20, cell: (l: Lead) => ({ value: getLeadStatus(l.status).label }) },
    { header: header("Nhân viên"), width: 18, cell: (l: Lead) => ({ value: l.assignee ?? "" }) },
    { header: header("Lịch hẹn"), width: 18, cell: (l: Lead) => ({ value: dateTime(l.appointment_at) }) },
    { header: header("Ghi chú"), width: 40, cell: (l: Lead) => ({ value: l.note ?? "", type: String }) },
  ];

  await writeExcelFile(leads, { columns }).toFile(fileName);
}
