/**
 * Danh sách SĐT theo nhân viên (supabase/034_ads_staff_phones.sql): từng số khách để lại qua tin nhắn (Pancake) và số
 * khách điền form (Facebook), gom theo nhân viên phụ trách TKQC để so với số Data nhân viên báo. File này là phần
 * tính toán thuần (không gọi mạng, không import gì) để kiểm thử riêng được: tests/ads-auto.test.mjs.
 */

/** Vì sao một số chưa gắn được nhân viên. */
export type PhoneGap = "no_ad" | "unmapped" | "outside" | "no_staff";
export type PhoneOutcome = "new" | "duplicate" | "invalid" | "error";

export type StaffPhone = {
  id: number;
  report_date: string; // yyyy-MM-dd (giờ Việt Nam)
  /** Lúc máy kéo số về (thường 1–2 phút sau khi khách để lại số). */
  at: string;
  phone: string;
  full_name: string | null;
  outcome: PhoneOutcome;
  ad_id: string | null;
  ad_name: string | null;
  /** Mục tiêu tối ưu của quảng cáo theo Pancake: CONVERSATIONS, LEAD_GENERATION… */
  ad_goal: string | null;
  ad_account_id: string | null;
  ads_staff_id: string | null;
  gap: PhoneGap | null;
  page_name: string | null;
  pancake_url: string;
};

/** Số khách điền form tức thì của một TKQC trong một ngày, theo Facebook. */
export type FormLeads = { report_date: string; ad_account_id: string; ads_staff_id: string | null; leads: number };

export type StaffPhonesResult = {
  /** Lúc bắt đầu có từng số Pancake (trước đó chỉ có số đếm theo thống kê). */
  since: string | null;
  phones: StaffPhone[];
  forms: FormLeads[];
};

export const GAP_LABELS: Record<PhoneGap, string> = {
  unmapped: "Quảng cáo đang tra TKQC",
  outside: "TKQC chưa có trong hệ thống",
  no_staff: "TKQC chưa giao nhân viên",
  no_ad: "Khách không đến từ quảng cáo",
};
const GAP_ORDER: PhoneGap[] = ["unmapped", "outside", "no_staff", "no_ad"];

export const OUTCOME_LABELS: Record<PhoneOutcome, string> = {
  new: "Khách mới",
  duplicate: "Đã có trong Lead",
  invalid: "Số sai",
  error: "Lỗi thêm vào Lead",
};

/** Số được tính là Data: đúng dạng số điện thoại (số sai vẫn hiện để biết nhưng không tính). */
export const countsAsData = (p: StaffPhone) => p.outcome !== "invalid";

/** Hội thoại Pancake của một số (lấy từ đường mở hội thoại "…?c_id=<hội thoại>"). */
const conversationOf = (p: StaffPhone) => p.pancake_url.split("c_id=")[1] || `#${p.id}`;

/**
 * Đếm KHÁCH (không đếm số): các số cùng một hội thoại là một khách; hai hội thoại có chung một số (khách nhắn qua 2
 * page) cũng là một khách. Số sai không tính.
 */
export function countCustomers(phones: StaffPhone[]): number {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x);
    parent.set(find(a), find(b));
  };
  for (const p of phones.filter(countsAsData)) union(`c:${conversationOf(p)}`, `p:${p.phone}`);
  return new Set([...parent.keys()].map(find)).size;
}

export type PhoneGroup = {
  /** id nhân viên, hoặc "gap:<lý do>". */
  key: string;
  staffId: string | null;
  gap: PhoneGap | null;
  phones: StaffPhone[];
  forms: FormLeads[];
  /** Số khách để lại số (đúng dạng) theo Pancake: một khách để lại nhiều số chỉ tính 1. */
  pancake: number;
  /** Khách điền form theo Facebook. */
  form: number;
  total: number;
  /** Số Data nhân viên báo; null = chưa báo (hoặc nhóm không phải nhân viên). */
  reported: number | null;
};

/**
 * Gom các số của MỘT ngày theo nhân viên. `reported`: số Data từng nhân viên báo ngày đó (id → số); nhân viên có báo
 * mà hệ thống không thấy số nào vẫn có nhóm. Nhóm nhân viên xếp theo tên, các nhóm chưa gắn được nhân viên xuống cuối.
 */
export function groupPhones(
  day: string,
  data: Pick<StaffPhonesResult, "phones" | "forms">,
  reported: Map<string, number>,
  staffName: (id: string) => string | null | undefined,
): PhoneGroup[] {
  const groups = new Map<string, PhoneGroup>();
  const get = (staffId: string | null, gap: PhoneGap | null) => {
    const key = staffId ?? `gap:${gap ?? "no_staff"}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, staffId, gap: staffId ? null : gap ?? "no_staff", phones: [], forms: [], pancake: 0, form: 0, total: 0, reported: null };
      groups.set(key, g);
    }
    return g;
  };
  for (const p of data.phones) if (p.report_date === day) get(p.ads_staff_id, p.gap).phones.push(p);
  for (const f of data.forms) if (f.report_date === day && f.leads > 0) get(f.ads_staff_id, "no_staff").forms.push(f);
  for (const [staffId, count] of reported) get(staffId, null).reported = count;

  for (const g of groups.values()) {
    g.phones.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
    g.pancake = countCustomers(g.phones);
    g.form = g.forms.reduce((sum, f) => sum + f.leads, 0);
    g.total = g.pancake + g.form;
  }
  const name = (g: PhoneGroup) => (g.staffId ? staffName(g.staffId) ?? "" : "");
  return [...groups.values()].sort((a, b) => {
    if (a.staffId && b.staffId) return name(a).localeCompare(name(b), "vi");
    if (a.staffId || b.staffId) return a.staffId ? -1 : 1;
    return GAP_ORDER.indexOf(a.gap ?? "no_staff") - GAP_ORDER.indexOf(b.gap ?? "no_staff");
  });
}

/** Câu so số nhân viên báo với số hệ thống thấy. */
export function verdictText(g: Pick<PhoneGroup, "reported" | "total">): { tone: "match" | "off" | "none"; text: string } {
  if (g.reported === null) return { tone: "none", text: "Chưa báo" };
  const diff = g.reported - g.total;
  if (diff === 0) return { tone: "match", text: "Khớp" };
  return { tone: "off", text: diff > 0 ? `NV báo nhiều hơn ${diff}` : `NV báo ít hơn ${-diff}` };
}
