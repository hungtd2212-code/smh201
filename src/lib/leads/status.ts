/**
 * 13 trạng thái của một lead Telesale.
 * `key` là giá trị lưu trong cột `leads.status` của Supabase — đừng đổi key
 * sau khi đã có dữ liệu (đổi `label`/`color` thì thoải mái).
 */
export const LEAD_STATUSES = [
  { key: "so_moi", label: "Số mới", color: "#0ea5e9" },
  { key: "chua_lien_he_duoc", label: "Chưa liên hệ được", color: "#64748b" },
  { key: "goi_lai_sau", label: "Gọi lại sau", color: "#6366f1" },
  { key: "hen_lich", label: "Hẹn lịch", color: "#2563eb" },
  { key: "tiem_nang", label: "Tiềm năng", color: "#22c55e" },
  { key: "tham_khao", label: "Tham khảo", color: "#eab308" },
  { key: "da_lam_dich_vu", label: "Đã làm dịch vụ", color: "#0f766e" },
  { key: "fail", label: "Fail", color: "#ef4444" },
  { key: "so_het_nhu_cau", label: "Số hết nhu cầu", color: "#78716c" },
  { key: "so_check_huy", label: "Số check huỷ", color: "#b45309" },
  { key: "so_huy", label: "Số huỷ", color: "#f97316" },
  { key: "so_trung", label: "Số trùng", color: "#a855f7" },
  { key: "trung_dich_vu_khac", label: "Trùng dịch vụ khác", color: "#ec4899" },
] as const;

export type LeadStatusKey = (typeof LEAD_STATUSES)[number]["key"];

export const LEAD_STATUS_KEYS = LEAD_STATUSES.map((s) => s.key) as LeadStatusKey[];

const BY_KEY = new Map<string, (typeof LEAD_STATUSES)[number]>(
  LEAD_STATUSES.map((s) => [s.key, s]),
);

export function getLeadStatus(key: string) {
  return BY_KEY.get(key) ?? { key, label: key, color: "#94a3b8" };
}

/**
 * Các trạng thái KHÔNG tính vào "Số sale thực nhận"
 * (số trùng và số huỷ không phải là lead thật để sale chăm).
 */
export const NOT_RECEIVED_STATUSES: readonly LeadStatusKey[] = [
  "so_trung",
  "trung_dich_vu_khac",
  "so_huy",
];
