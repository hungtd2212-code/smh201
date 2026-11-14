"use client";

import { BellRing } from "lucide-react";
import type { CatalogNames } from "@/components/catalog-provider";
import { duplicateCount, GENDER_LABELS, money, vnDateTime } from "@/lib/leads/crm";
import type { Lead, LeadStatusRow } from "@/lib/leads/types";
import { cn } from "@/lib/utils";
import { StatusPicker } from "./status-chip";

type Column = {
  key: string;
  title: string;
  /** Lớp của cả cột (độ rộng, canh lề…). */
  className?: string;
  cell: (lead: Lead, index: number) => React.ReactNode;
};

/**
 * Bảng Lead kẻ ô như Google Sheet, đúng thứ tự cột chủ phòng khám gửi. Bấm vào bất kỳ đâu trên dòng để mở số đó;
 * riêng ô Tình trạng bấm vào là đổi trạng thái ngay. Hai cột Tên KH và Data đứng yên khi kéo ngang (màn hình rộng).
 * Chữ dài tự xuống dòng trong ô (không bị cắt); dòng chẵn / lẻ khác màu cho dễ dò theo hàng.
 */
export function LeadsGrid({
  leads,
  offset,
  statuses,
  names,
  adsStaffOf,
  canChangeStatus,
  onOpen,
  onPickStatus,
  selectable,
  selected,
  onToggle,
  onTogglePage,
}: {
  leads: Lead[];
  /** STT của dòng đầu trang = offset + 1. */
  offset: number;
  statuses: LeadStatusRow[];
  names: CatalogNames;
  /** Nhân viên Ads của số (cột NV ADS). */
  adsStaffOf: (lead: Lead) => string | null;
  canChangeStatus: boolean;
  onOpen: (lead: Lead) => void;
  onPickStatus: (lead: Lead, statusId: string) => void;
  /** Hiện ô chọn để chuyển vào thùng rác (người có quyền Xoá dữ liệu). */
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onTogglePage: () => void;
}) {
  const columns: Column[] = [
    { key: "stt", title: "STT", className: "w-12 text-right tabular-nums text-muted-foreground", cell: (_, i) => offset + i + 1 },
    { key: "day", title: "NGÀY", className: "tabular-nums", cell: (l) => vnDateTime(l.created_at)?.day },
    { key: "time", title: "Giờ ra số", className: "tabular-nums", cell: (l) => vnDateTime(l.created_at)?.time },
    {
      key: "name",
      title: "TÊN KH",
      className: "w-44 max-w-44 font-medium md:sticky md:left-0 md:z-[1]",
      cell: (l) => <Wrap text={l.full_name} className="w-40" />,
    },
    {
      key: "phone",
      title: "DATA",
      className: "w-28 tabular-nums md:sticky md:left-44 md:z-[1] md:shadow-[inset_-1px_0_0_var(--border)]",
      cell: (l) => l.phone,
    },
    { key: "note", title: "Lưu ý", cell: (l) => <Wrap text={l.note} className="w-60" lines={4} /> },
    { key: "post", title: "BÀI CHẠY", cell: (l) => <Wrap text={names.adPost(l.ad_post_id)} className="w-56" /> },
    {
      key: "ads",
      title: "NV ADS",
      cell: (l) => {
        const id = adsStaffOf(l);
        return <Wrap text={id ? names.adsStaff(id) ?? "Nhân viên đã xoá" : null} className="w-36" />;
      },
    },
    { key: "service", title: "DỊCH VỤ", cell: (l) => <Wrap text={names.service(l.service_id) ?? l.service} className="w-36" /> },
    { key: "page", title: "PAGE", cell: (l) => <Wrap text={names.page(l.page_id)} className="w-48" /> },
    { key: "source", title: "NGUỒN", cell: (l) => <Wrap text={names.channel(l.channel_id) ?? l.source} className="w-28" /> },
    {
      key: "dup",
      title: "TRÙNG",
      cell: (l) => {
        const n = duplicateCount(l);
        if (!n && !l.recontacted_at) return null;
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium",
              l.recontacted_at
                ? "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                : "bg-muted text-muted-foreground",
            )}
            title={l.recontacted_at ? "Khách vừa nhắn lại, chưa xử lý" : undefined}
          >
            {l.recontacted_at && <BellRing className="size-3" />}
            Trùng {n > 0 ? `×${n}` : ""}
          </span>
        );
      },
    },
    {
      key: "sale",
      title: "SALE",
      cell: (l) =>
        l.assignee ?? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
            Chưa chia
          </span>
        ),
    },
    {
      key: "transfer",
      title: "ĐẢO SỐ",
      className: "text-xs",
      cell: (l) =>
        l.transfer_count > 0 ? (
          <span title={`Đã đảo ${l.transfer_count} lần`}>
            từ {names.staff(l.previous_assignee_id) ?? "?"}
            {l.transfer_count > 1 && <span className="text-muted-foreground"> ×{l.transfer_count}</span>}
          </span>
        ) : null,
    },
    {
      key: "status",
      title: "TÌNH TRẠNG",
      cell: (l) => (
        <StatusPicker
          statuses={statuses}
          value={l.status_id}
          legacyStatus={l.status}
          disabled={!canChangeStatus}
          onPick={(id) => onPickStatus(l, id)}
        />
      ),
    },
    {
      key: "appt",
      title: "LỊCH HẸN",
      className: "tabular-nums",
      cell: (l) => {
        const d = vnDateTime(l.appointment_at);
        return d ? `${d.short}` : null;
      },
    },
    { key: "deal", title: "DOANH SỐ", className: "text-right tabular-nums", cell: (l) => money(l.deal_amount) },
    { key: "paid", title: "DOANH THU", className: "text-right tabular-nums", cell: (l) => money(l.paid_amount) },
    { key: "area", title: "KHU VỰC", cell: (l) => <Wrap text={l.area} className="w-32" /> },
    { key: "gender", title: "Giới Tính", cell: (l) => (l.gender ? GENDER_LABELS[l.gender] : null) },
    { key: "age", title: "TUỔI", className: "text-right tabular-nums", cell: (l) => l.age },
    { key: "budget", title: "NGÂN SÁCH", cell: (l) => <Wrap text={l.budget} className="w-32" /> },
    { key: "consult", title: "NHẬT KÝ TƯ VẤN", cell: (l) => <Wrap text={l.consult_info} className="w-80" lines={4} /> },
  ];

  const pageChosen = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const cellBase = "border border-border px-2 py-1.5 whitespace-nowrap align-middle";

  return (
    <div className="max-h-[calc(100svh-15rem)] min-h-64 overflow-auto rounded-lg border bg-card">
      <table className="w-max min-w-full border-collapse text-sm [&_td]:border-t-0 [&_th]:border-t-0">
        <thead className="sticky top-0 z-[2] bg-muted">
          <tr>
            {selectable && (
              <th className={cn(cellBase, "w-9 bg-muted")}>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label="Chọn cả trang"
                  checked={pageChosen}
                  onChange={onTogglePage}
                />
              </th>
            )}
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(cellBase, "bg-muted text-left text-xs font-semibold tracking-wide text-muted-foreground", c.className)}
              >
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead, index) => (
            <tr
              key={lead.id}
              className="group cursor-pointer"
              onClick={() => onOpen(lead)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.target === event.currentTarget) onOpen(lead);
              }}
              tabIndex={0}
              aria-label={`Mở ${lead.full_name} ${lead.phone}`}
            >
              {selectable && (
                <td className={cn(cellBase, rowBg(index))} onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={`Chọn ${lead.full_name}`}
                    checked={selected.has(lead.id)}
                    onChange={() => onToggle(lead.id)}
                  />
                </td>
              )}
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(cellBase, rowBg(index), c.className)}
                  onClick={c.key === "status" ? (event) => event.stopPropagation() : undefined}
                >
                  {c.cell(lead, index)}
                </td>
              ))}
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-10 text-center text-sm text-muted-foreground">
                Không có số nào khớp bộ lọc.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Nền của một dòng: dòng lẻ (1, 3, 5…) trắng, dòng chẵn xanh nhạt cho dễ dò theo hàng; rê chuột / chọn bằng bàn phím
 * thì vàng nhạt. Màu đặc (không trong suốt) vì hai cột Tên KH và Data đứng yên đè lên các cột khác khi kéo ngang.
 */
const rowBg = (index: number) =>
  cn(
    index % 2 === 0 ? "bg-card" : "bg-[oklch(0.955_0.025_236)] dark:bg-[oklch(0.265_0.035_250)]",
    "group-hover:bg-amber-50 group-focus-visible:bg-amber-50 dark:group-hover:bg-[oklch(0.3_0.035_80)] dark:group-focus-visible:bg-[oklch(0.3_0.035_80)]",
  );

/**
 * Ô chữ: tự xuống dòng trong độ rộng `className` để đọc đủ, không bị cắt. `lines`: ô có thể rất dài (Lưu ý, Nhật ký tư
 * vấn) thì chỉ hiện tối đa ngần ấy dòng — rê chuột hoặc mở số để xem đủ.
 */
function Wrap({ text, className, lines }: { text: string | null | undefined; className: string; lines?: 4 }) {
  if (!text) return null;
  return (
    <div className={cn("break-words whitespace-pre-line", lines === 4 && "line-clamp-4", className)} title={lines ? text : undefined}>
      {text}
    </div>
  );
}
