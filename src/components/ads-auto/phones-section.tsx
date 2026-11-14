"use client";

import { ExternalLink, FileText, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCatalogNames } from "@/components/catalog-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, formatDay } from "@/lib/ad-reports/dates";
import { fetchDailyData } from "@/lib/ad-reports/repo";
import type { AutoStatus } from "@/lib/ads-auto/compare";
import {
  GAP_LABELS,
  OUTCOME_LABELS,
  groupPhones,
  verdictText,
  type PhoneGroup,
  type StaffPhone,
  type StaffPhonesResult,
} from "@/lib/ads-auto/phones";
import { fetchStaffPhones } from "@/lib/ads-auto/repo";
import { cn } from "@/lib/utils";
import { DayPicker } from "./telegram-card";

const clock = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });
const vnDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });

const TONE: Record<"match" | "off" | "none", string> = {
  match: "text-emerald-700 dark:text-emerald-300",
  off: "font-semibold text-amber-700 dark:text-amber-300",
  none: "text-muted-foreground",
};
const OUTCOME_STYLE: Record<StaffPhone["outcome"], string> = {
  new: "text-emerald-700 dark:text-emerald-300",
  duplicate: "text-sky-700 dark:text-sky-300",
  invalid: "text-muted-foreground line-through",
  error: "text-red-700 dark:text-red-300",
};

/**
 * Danh sách SĐT theo nhân viên trong một ngày: từng số khách để lại qua tin nhắn (Pancake) và số khách điền form
 * (Facebook), gom theo nhân viên phụ trách TKQC, so với số Data nhân viên báo. `version` đổi → tải lại.
 */
export function PhonesSection({ status, today, version }: { status: AutoStatus; today: string; version: number }) {
  const names = useCatalogNames();
  const yesterday = addDays(today, -1);
  const [day, setDay] = useState(yesterday);
  const [data, setData] = useState<StaffPhonesResult | null | undefined>(undefined);
  const [reported, setReported] = useState<Map<string, number>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      Promise.all([fetchStaffPhones(day, day), fetchDailyData(day, day)])
        .then(([phones, daily]) => {
          if (!alive) return;
          setData(phones);
          setReported(new Map((daily?.rows ?? []).filter((r) => r.report_date === day).map((r) => [r.ads_staff_id, Number(r.data_count)])));
          setError(null);
        })
        .catch((err) => alive && setError(err instanceof Error ? err.message : String(err)));
    }, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [day, version]);

  const accounts = useMemo(() => new Map(status.accounts.map((a) => [a.ad_account_id, a.name])), [status.accounts]);
  const accountName = (id: string | null) => (id ? accounts.get(id) ?? names.adAccount(id) ?? "TKQC đã xoá" : "—");
  const groups = data ? groupPhones(day, data, reported, (id) => names.adsStaff(id)) : [];
  const sinceDay = data?.since ? vnDay.format(new Date(data.since)) : null;

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="grid gap-1">
        <h2 className="flex items-center gap-2 font-semibold">
          <ListChecks className="size-4 text-muted-foreground" />
          SĐT theo nhân viên
        </h2>
        <p className="text-sm text-muted-foreground">
          Từng số khách để lại qua tin nhắn (Pancake) và số khách điền form (Facebook), gom theo nhân viên phụ trách TKQC, để
          so từng số với số Data nhân viên báo ở Nhập liệu.
        </p>
      </div>
      <DayPicker value={day} lastDay={yesterday} onChange={setDay} />

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : data === undefined ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : data === null ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Cơ sở dữ liệu chưa được cập nhật cho phần này (file supabase/034_ads_staff_phones.sql chưa chạy).
        </p>
      ) : (
        <>
          {(!sinceDay || day <= sinceDay) && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              {!sinceDay || !data.since
                ? "Chưa kéo được số Pancake nào."
                : day === sinceDay
                  ? `Ngày này chỉ có số Pancake từ ${clock.format(new Date(data.since))} (lúc bắt đầu kéo từng số) — khách để lại số trước giờ đó không có trong danh sách.`
                  : `Từng số Pancake có từ ngày ${formatDay(sinceDay)}. Ngày trước đó chỉ có số đếm ở bảng đối chiếu bên trên.`}
            </p>
          )}
          {groups.length === 0 ? (
            <p className="rounded-lg border px-3 py-6 text-center text-sm text-muted-foreground">Ngày {formatDay(day)} chưa có số nào.</p>
          ) : (
            <div className="grid gap-3">
              {groups.map((g) => (
                <GroupBlock key={g.key} group={g} title={g.staffId ? names.adsStaff(g.staffId) ?? "Nhân viên đã xoá" : GAP_LABELS[g.gap ?? "no_staff"]} accountName={accountName} />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Pancake: tính theo khách — một khách để lại nhiều số chỉ tính 1; giờ là lúc máy kéo số về (thường 1–2 phút sau khi
            khách để lại số). Khách bấm nhiều
            quảng cáo thì tính cho quảng cáo bấm sau cùng (số kéo về trước bản cập nhật này tính theo quảng cáo đầu tiên). “Đã có
            trong Lead” = số đã có sẵn trong bảng Lead (khách cũ) — vẫn tính. Số sai không tính. Form: số khách điền form tức
            thì theo Facebook, chưa có tên và số điện thoại. Nhân viên được tính theo người phụ trách TKQC hôm đó.
          </p>
        </>
      )}
    </section>
  );
}

function GroupBlock({ group: g, title, accountName }: { group: PhoneGroup; title: string; accountName: (id: string | null) => string }) {
  const verdict = g.staffId ? verdictText(g) : null;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-muted/40 px-3 py-2 text-sm">
        <span className={cn("font-semibold", !g.staffId && "text-muted-foreground")}>{title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums text-muted-foreground">
          <span>
            Pancake <b className="text-foreground">{g.pancake}</b>
          </span>
          <span>
            Form <b className="text-foreground">{g.form}</b>
          </span>
          <span>
            Cộng <b className="text-foreground">{g.total}</b>
          </span>
          {g.staffId && (
            <span>
              NV báo <b className="text-foreground">{g.reported ?? "—"}</b>
            </span>
          )}
        </span>
        {verdict && <span className={cn("ml-auto text-xs", TONE[verdict.tone])}>{verdict.text}</span>}
      </div>
      {g.phones.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-t">
                <th className="w-16 px-3 py-1.5 text-left font-normal">Giờ</th>
                <th className="px-3 py-1.5 text-left font-normal">SĐT</th>
                <th className="px-3 py-1.5 text-left font-normal">Khách</th>
                <th className="px-3 py-1.5 text-left font-normal">Quảng cáo</th>
                <th className="px-3 py-1.5 text-left font-normal">TKQC</th>
                <th className="px-3 py-1.5 text-left font-normal">Tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {g.phones.map((p) => (
                <tr key={p.id} className="border-t border-border/60">
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{clock.format(new Date(p.at))}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    <a
                      href={p.pancake_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium hover:underline"
                      title="Mở hội thoại trên Pancake"
                    >
                      {p.phone}
                      <ExternalLink className="size-3 text-muted-foreground" />
                    </a>
                  </td>
                  <td className="max-w-40 truncate px-3 py-1.5">{p.full_name ?? "—"}</td>
                  <td className="max-w-48 truncate px-3 py-1.5" title={p.ad_id ?? undefined}>
                    {p.ad_id ? p.ad_name ?? `QC …${p.ad_id.slice(-6)}` : "—"}
                    {p.ad_goal === "LEAD_GENERATION" && <span className="ml-1 text-xs text-muted-foreground">(form)</span>}
                  </td>
                  <td className="max-w-40 truncate px-3 py-1.5 text-muted-foreground">{accountName(p.ad_account_id)}</td>
                  <td className={cn("px-3 py-1.5 text-xs whitespace-nowrap", OUTCOME_STYLE[p.outcome])}>
                    {OUTCOME_LABELS[p.outcome]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {g.forms.map((f) => (
        <p key={f.ad_account_id} className="flex items-center gap-2 border-t px-3 py-1.5 text-sm">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span>
            Form Facebook · {accountName(f.ad_account_id)}: <b className="tabular-nums">{f.leads}</b> khách điền form
            <span className="text-xs text-muted-foreground"> (chưa có tên, SĐT)</span>
          </span>
        </p>
      ))}
      {g.phones.length === 0 && g.forms.length === 0 && (
        <p className="border-t px-3 py-1.5 text-sm text-muted-foreground">Hệ thống chưa thấy số nào của nhân viên này trong ngày.</p>
      )}
    </div>
  );
}
