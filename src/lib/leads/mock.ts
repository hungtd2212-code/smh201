import type { LeadStatusKey } from "./status";
import { DENTAL_SERVICES, LEAD_SOURCES, type Lead } from "./types";

/**
 * Dữ liệu MẪU — chỉ dùng khi chưa kết nối Supabase, để xem trước giao diện.
 * Tên và số điện thoại đều là ngẫu nhiên, không phải khách thật.
 */

const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Vũ", "Đặng", "Bùi", "Đỗ", "Phan", "Ngô", "Dương"];
const DEM = ["Thị", "Văn", "Minh", "Thu", "Ngọc", "Đức", "Hồng", "Quang", "Thanh", "Khánh"];
const TEN = ["Anh", "Hà", "Linh", "Hương", "Nam", "Long", "Trang", "Huy", "Mai", "Phương", "Tuấn", "Lan", "Dũng", "Yến", "Sơn", "Thảo", "Hiếu", "Ngân"];
const SALES = ["Thu Hà", "Minh Anh", "Ngọc Lan", "Quốc Bảo"];
const NOTES = [
  "Khách hỏi giá, hẹn gọi lại buổi tối",
  "Đã gửi bảng giá qua Zalo",
  "Khách đang cân nhắc thêm",
  "Muốn tư vấn trả góp",
  "Không nghe máy lần 2",
  "Ở xa, hỏi có làm cuối tuần không",
  null,
  null,
  null,
];

/** Tỷ lệ trạng thái phỏng theo số liệu thực tế của một tháng telesale. */
const STATUS_WEIGHTS: [LeadStatusKey, number][] = [
  ["tham_khao", 42],
  ["so_trung", 14.5],
  ["chua_lien_he_duoc", 13],
  ["so_huy", 8],
  ["da_lam_dich_vu", 6.2],
  ["so_check_huy", 6],
  ["so_het_nhu_cau", 5.5],
  ["goi_lai_sau", 1.5],
  ["fail", 1.2],
  ["tiem_nang", 1],
  ["hen_lich", 0.6],
  ["so_moi", 0.3],
  ["trung_dich_vu_khac", 0.2],
];

/** Bộ sinh số ngẫu nhiên có seed → dữ liệu mẫu ổn định giữa các lần tải trang. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function pickStatus(rand: () => number): LeadStatusKey {
  const total = STATUS_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [status, weight] of STATUS_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return status;
  }
  return "tham_khao";
}

/** Sinh lead mẫu cho `days` ngày gần nhất, tính đến thời điểm `now`. */
export function generateMockLeads(now: Date, days = 100): Lead[] {
  const rand = mulberry32(20261111);
  const leads: Lead[] = [];
  let counter = 0;

  for (let offset = days; offset >= 0; offset--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const perDay = 8 + Math.floor(rand() * 11); // 8–18 lead mỗi ngày

    for (let i = 0; i < perDay; i++) {
      const createdAt = new Date(day);
      createdAt.setHours(8 + Math.floor(rand() * 13), Math.floor(rand() * 60), 0, 0);
      if (createdAt > now) continue;

      // Lead trong vài giờ gần đây thì chưa kịp xử lý.
      const isFresh = now.getTime() - createdAt.getTime() < 3 * 3600_000;
      const status: LeadStatusKey = isFresh ? "so_moi" : pickStatus(rand);

      const hasAppointment =
        status === "hen_lich" ||
        status === "da_lam_dich_vu" ||
        ((status === "so_check_huy" || status === "tiem_nang") && rand() < 0.5);
      const appointmentAt = hasAppointment
        ? new Date(
            createdAt.getFullYear(),
            createdAt.getMonth(),
            createdAt.getDate() + 1 + Math.floor(rand() * 6),
            9 + Math.floor(rand() * 9),
            rand() < 0.5 ? 0 : 30,
          )
        : null;

      const source = pick(rand, LEAD_SOURCES);
      const isAds = source === "Facebook Ads" || source === "TikTok";
      counter += 1;

      leads.push({
        id: `mau-${counter}`,
        created_at: createdAt.toISOString(),
        full_name: `${pick(rand, HO)} ${pick(rand, DEM)} ${pick(rand, TEN)}`,
        phone: `09${Math.floor(rand() * 1e8).toString().padStart(8, "0")}`,
        service: pick(rand, DENTAL_SERVICES),
        source,
        ads_id: isAds ? `AD${Math.floor(100000 + rand() * 900000)}` : null,
        status,
        assignee: status === "so_moi" ? null : pick(rand, SALES),
        appointment_at: appointmentAt ? appointmentAt.toISOString() : null,
        note: pick(rand, NOTES),
      });
    }
  }

  // Mới nhất trước (chuỗi ISO so sánh được theo thứ tự thời gian).
  return leads.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
