"use client";

import { metricsOf, type Summary, type Totals } from "@/lib/ads-stats/compute";
import { DASH, formatNumber, formatPercent, shortDay, weekday } from "@/lib/ads-stats/format";
import { cn } from "@/lib/utils";

/** Các bảng số liệu ads: cùng một bộ cột như file Google Sheet "BC ads". */

const cell = "px-2.5 py-1.5 text-right whitespace-nowrap tabular-nums";
const head = "px-2.5 py-2 text-right font-medium whitespace-nowrap";
const group = "border-l";
/** Cột đầu đứng yên khi kéo ngang. */
const sticky = "sticky left-0 z-10 bg-inherit text-left shadow-[1px_0_0_0_var(--border)]";
/** Tên nhóm cột: căn trái để luôn thấy khi bảng rộng hơn màn hình. */
const groupHead = "px-2.5 pt-2 pb-0 text-left text-xs font-medium whitespace-nowrap text-muted-foreground border-l";

/** Số 0 và "–" hiện mờ để mắt dừng ở các ô có số. */
function Num({ value, percent = false }: { value: number | null; percent?: boolean }) {
  if (value === null) return <span className="text-muted-foreground/60">{DASH}</span>;
  if (value === 0) return <span className="text-muted-foreground/60">0</span>;
  return <>{percent ? formatPercent(value) : formatNumber(value)}</>;
}

/** Hai dòng tiêu đề của các cột chỉ số (đặt sau cột đầu và các cột TKQC nếu có). */
function MetricHeads() {
  return (
    <>
      <th className={cn(head, group)}>Chi tiêu ads</th>
      <th className={head}>Tổng mess</th>
      <th className={head}>Giá mess</th>
      <th className={head}>Data</th>
      <th className={head}>Giá data</th>
      <th className={head}>Tỉ lệ xin số</th>
      <th className={cn(head, group)}>Doanh số</th>
      <th className={head}>Doanh thu</th>
      <th className={head}>Ads / Doanh số</th>
      <th className={cn(head, group)} title="Khách hàng tiềm năng">
        KHTN
      </th>
      <th className={head}>Đặt lịch hẹn</th>
      <th className={head}>Lạc tỉnh</th>
      <th className={head}>Không tương tác</th>
    </>
  );
}

/** 13 ô chỉ số của một dòng (một ngày, một tuần, một nhân viên hoặc dòng tổng). */
function MetricCells({ totals }: { totals: Totals }) {
  const m = metricsOf(totals);
  return (
    <>
      <td className={cn(cell, group, "font-medium")}>
        <Num value={totals.spend} />
      </td>
      <td className={cell}>
        <Num value={totals.messages} />
      </td>
      <td className={cell}>
        <Num value={m.costPerMessage} />
      </td>
      <td className={cell}>
        <Num value={totals.data} />
      </td>
      <td className={cell}>
        <Num value={m.costPerData} />
      </td>
      <td className={cell}>
        <Num value={m.dataRate} percent />
      </td>
      <td className={cn(cell, group)}>
        <Num value={totals.sales} />
      </td>
      <td className={cell}>
        <Num value={totals.revenue} />
      </td>
      <td className={cell}>
        <Num value={m.adsOverSales} percent />
      </td>
      <td className={cn(cell, group)}>
        <Num value={totals.potential} />
      </td>
      <td className={cell}>
        <Num value={totals.booked} />
      </td>
      <td className={cell}>
        <Num value={totals.wrongArea} />
      </td>
      <td className={cell}>
        <Num value={totals.noResponse} />
      </td>
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

const QUALITY_GROUP = (
  <th colSpan={4} className={groupHead}>
    Chất lượng data
  </th>
);

/**
 * Bảng theo ngày (giống sheet "Tổng" và sheet từng nhân viên): mỗi dòng một ngày, dòng tổng ở trên
 * cùng. `accounts` = các cột chi tiêu theo TKQC (bỏ trống = không hiện các cột này).
 * Có `onSelectDay` thì bấm vào ngày để chọn ngày đó (trang nhập số liệu).
 */
export function DailyStatsTable({
  summary,
  accounts,
  totalLabel,
  selectedDay,
  onSelectDay,
  markMissing = false,
}: {
  summary: Summary;
  accounts: { id: string; name: string }[];
  totalLabel: string;
  selectedDay?: string;
  onSelectDay?: (day: string) => void;
  /** Đánh dấu "Chưa nhập" ở những ngày chưa có dòng kết quả. */
  markMissing?: boolean;
}) {
  return (
    <Frame>
      <thead>
        <tr className="bg-muted text-xs">
          <th className={cn(head, sticky)} rowSpan={2}>
            Ngày
          </th>
          {accounts.length > 0 && (
            <th colSpan={accounts.length} className={groupHead}>
              Chi tiêu theo TKQC
            </th>
          )}
          <th colSpan={6} className={groupHead}>
            Chi tiêu · Mess · Data
          </th>
          <th colSpan={3} className={groupHead}>
            Doanh số
          </th>
          {QUALITY_GROUP}
        </tr>
        <tr className="border-b bg-muted text-xs">
          {accounts.map((account, index) => (
            <th key={account.id} className={cn(head, index === 0 && group)}>
              {account.name}
            </th>
          ))}
          <MetricHeads />
        </tr>
      </thead>
      <tbody>
        <tr className="border-b bg-accent font-semibold text-accent-foreground">
          <td className={cn(cell, sticky)}>{totalLabel}</td>
          {accounts.map((account, index) => (
            <td key={account.id} className={cn(cell, index === 0 && group)}>
              <Num value={summary.spendByAccount.get(account.id) ?? 0} />
            </td>
          ))}
          <MetricCells totals={summary.total} />
        </tr>
        {summary.days.map((row) => {
          const selected = row.day === selectedDay;
          const label = (
            <>
              <span className="tabular-nums">{shortDay(row.day)}</span>
              <span className="ml-1.5 text-xs text-muted-foreground">{weekday(row.day)}</span>
              {markMissing && !row.entered && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                  Chưa nhập
                </span>
              )}
            </>
          );
          return (
            <tr
              key={row.day}
              className={cn(
                "border-b last:border-0",
                selected ? "bg-muted" : "bg-card hover:bg-muted",
                onSelectDay && "cursor-pointer",
              )}
              onClick={onSelectDay ? () => onSelectDay(row.day) : undefined}
              title={row.note ?? undefined}
            >
              <td className={cn(cell, sticky, selected && "font-semibold")}>
                {onSelectDay ? (
                  <button type="button" className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {label}
                  </button>
                ) : (
                  label
                )}
              </td>
              {accounts.map((account, index) => (
                <td key={account.id} className={cn(cell, index === 0 && group)}>
                  <Num value={row.spendByAccount.get(account.id) ?? 0} />
                </td>
              ))}
              <MetricCells totals={row.totals} />
            </tr>
          );
        })}
      </tbody>
    </Frame>
  );
}

export type TotalsRow = { key: string; label: string; totals: Totals; hint?: string; strong?: boolean };

/** Bảng tổng theo nhóm (giống sheet "BÁO CÁO TUẦN"): mỗi dòng một tuần hoặc một nhân viên. */
export function TotalsTable({ firstColumn, rows, empty }: { firstColumn: string; rows: TotalsRow[]; empty: string }) {
  return (
    <Frame>
      <thead>
        <tr className="bg-muted text-xs">
          <th className={cn(head, sticky)} rowSpan={2}>
            {firstColumn}
          </th>
          <th colSpan={6} className={groupHead}>
            Chi tiêu · Mess · Data
          </th>
          <th colSpan={3} className={groupHead}>
            Doanh số
          </th>
          {QUALITY_GROUP}
        </tr>
        <tr className="border-b bg-muted text-xs">
          <MetricHeads />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={14} className="h-20 text-center text-muted-foreground">
              {empty}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={row.key}
              className={cn(
                "border-b last:border-0",
                row.strong ? "bg-accent font-semibold text-accent-foreground" : "bg-card hover:bg-muted",
              )}
              title={row.hint}
            >
              <td className={cn(cell, sticky)}>{row.label}</td>
              <MetricCells totals={row.totals} />
            </tr>
          ))
        )}
      </tbody>
    </Frame>
  );
}

/** Lời báo khi cơ sở dữ liệu chưa có bảng số liệu ngày. */
export function AdsStatsNotReady() {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      Trang này chưa dùng được: cơ sở dữ liệu chưa được cập nhật cho số liệu ads hằng ngày (file{" "}
      <code>supabase/006_ads_daily_stats.sql</code> chưa chạy). Các phần khác vẫn chạy bình thường.
    </p>
  );
}

export function StatsError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
      <p className="font-medium text-destructive">Không tải được số liệu</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  );
}
