"use client";

import { ArrowDown } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  funnelCounts,
  ownerOf,
  totalsByStaff,
  zero,
  type FunnelCounts,
  type FunnelLead,
  type Totals,
} from "@/lib/ad-reports/aggregate";
import { fetchFunnelLeads, type FunnelLeadRow } from "@/lib/ad-reports/leads";
import type { AdAccountAssignment, AdsStaff, Campaign, Channel } from "@/lib/catalog/types";
import { NOT_RECEIVED_STATUSES } from "@/lib/leads/status";
import { cn } from "@/lib/utils";
import type { DayRange } from "./period-picker";
import { FIRST_TH, TD, TH } from "./period-table";
import { StatsError } from "./shared";

/**
 * Phân tích → Phễu khách hàng (kiểu HubSpot / GA4): Chi tiêu → Mess → Data → Lead telesale nhận → Hẹn lịch →
 * Đã làm dịch vụ, kèm tỉ lệ chuyển giữa các bước và giá mỗi bước. Doanh thu sẽ thêm khi có phân hệ Thu ngân.
 *   • Mess, Data: nhân viên Ads báo hằng ngày (màn Nhập liệu).
 *   • Lead, Hẹn lịch, Đã làm dịch vụ: từ Telesale → Leads (lead tạo trong khoảng ngày; tính theo trạng thái hiện tại).
 *   • Tính cho từng nhân viên Ads qua Chiến dịch của lead → TKQC → người cầm TKQC ngày đó.
 */

type Entries = Parameters<typeof totalsByStaff>[0];
type LeadsState = { status: "loading" } | { status: "ready"; leads: FunnelLeadRow[] } | { status: "error"; message: string };
const ALL = "__all";

function useFunnelLeads(range: DayRange) {
  const key = `${range.from}:${range.to}`;
  const [loaded, setLoaded] = useState<{ key: string; state: LeadsState } | null>(null);
  useEffect(() => {
    if (!range.from || !range.to) return;
    let cancelled = false;
    fetchFunnelLeads(range.from, range.to)
      .then((leads) => {
        if (!cancelled) setLoaded({ key, state: { status: "ready", leads } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoaded({ key, state: { status: "error", message: error instanceof Error ? error.message : String(error) } });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, range.from, range.to]);
  return loaded?.key === key ? loaded.state : ({ status: "loading" } as LeadsState);
}

const money = (n: number | null) => (n === null ? "–" : `${Math.round(n).toLocaleString("vi-VN")}đ`);
const count = (n: number) => n.toLocaleString("vi-VN");
const rate = (a: number, b: number) =>
  b > 0 ? `${((a / b) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%` : "–";
const per = (spend: number, n: number) => (n > 0 ? spend / n : null);

/** Đậm dần theo từng bước của phễu (một màu xanh). */
const STEP_SHADES = [30, 45, 60, 75, 90];

export function FunnelView({
  entries,
  assignments,
  campaigns,
  channels,
  people,
  staffId,
  range,
  who,
}: {
  entries: Entries;
  assignments: AdAccountAssignment[];
  campaigns: Campaign[];
  channels: Channel[];
  people: AdsStaff[];
  /** null = tất cả nhân viên. */
  staffId: string | null;
  range: DayRange;
  who: string;
}) {
  const leadsState = useFunnelLeads(range);
  const [channel, setChannel] = useState(ALL);

  const keep = (day: string) => day >= range.from && day <= range.to;
  const byStaff = totalsByStaff(entries, keep);
  const adTotals: Totals =
    staffId === null ? [...byStaff.values()].reduce((a, b) => ({ spend: a.spend + b.spend, messages: a.messages + b.messages, data: a.data + b.data }), zero()) : (byStaff.get(staffId) ?? zero());

  if (leadsState.status === "error") return <StatsError message={leadsState.message} />;
  if (leadsState.status === "loading") return <Skeleton className="h-80 w-full rounded-xl" />;

  // Lead → TKQC (qua chiến dịch) → người cầm TKQC vào ngày tạo lead.
  const accountOfCampaign = new Map(campaigns.map((c) => [c.id, c.ad_account_id]));
  const leads: (FunnelLead & { owner: string | null; channelId: string | null })[] = leadsState.leads
    .filter((l) => channel === ALL || l.channelId === channel)
    .map((l) => {
      const accountId = l.campaignId ? (accountOfCampaign.get(l.campaignId) ?? null) : null;
      return {
        day: l.day,
        status: l.status,
        hasAppointment: l.hasAppointment,
        invalidPhone: l.invalidPhone,
        accountId,
        channelId: l.channelId,
        owner: accountId ? ownerOf(assignments, accountId, l.day) : null,
      };
    });
  const scoped = staffId === null ? leads : leads.filter((l) => l.owner === staffId);
  const fc = funnelCounts(scoped, NOT_RECEIVED_STATUSES);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="w-56" aria-label="Kênh của lead">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Lead của mọi kênh</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                Kênh: {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">Kênh chỉ lọc phần lead Telesale; chi tiêu, mess, data là của quảng cáo.</span>
      </div>

      <FunnelChart title={`Phễu khách hàng${who ? ` — ${who}` : ""}`} ad={adTotals} counts={fc} />

      {staffId === null && (
        <StaffFunnelTable people={people} byStaff={byStaff} leads={leads} unattributed={leads.filter((l) => l.owner === null)} />
      )}
      {staffId !== null && leads.filter((l) => l.owner === null).length > 0 && (
        <p className="text-sm text-muted-foreground">
          Có {count(funnelCounts(leads.filter((l) => l.owner === null), NOT_RECEIVED_STATUSES).leads)} lead trong khoảng này
          chưa gắn Chiến dịch → TKQC nên chưa tính cho nhân viên nào.
        </p>
      )}
    </>
  );
}

function FunnelChart({ title, ad, counts: fc }: { title: string; ad: Totals; counts: FunnelCounts }) {
  const steps = [
    { label: "Mess", value: ad.messages, source: "Nhân viên Ads báo" },
    { label: "Data xin được", value: ad.data, source: "Nhân viên Ads báo" },
    { label: "Lead telesale nhận", value: fc.leads, source: "Telesale (bỏ số trùng, huỷ, số sai)" },
    { label: "Hẹn lịch", value: fc.booked, source: "Lead đang Hẹn lịch / có ngày hẹn" },
    { label: "Đã làm dịch vụ", value: fc.done, source: "Lead ở trạng thái Đã làm dịch vụ" },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  const cards = [
    { label: "Chi tiêu", value: money(ad.spend) },
    { label: "Giá mỗi lead", value: money(per(ad.spend, fc.leads)) },
    { label: "Giá mỗi lịch hẹn", value: money(per(ad.spend, fc.booked)) },
    { label: "Giá mỗi khách làm dịch vụ", value: money(per(ad.spend, fc.done)) },
    { label: "Data → Hẹn lịch", value: rate(fc.booked, ad.data) },
    { label: "Hẹn lịch → Làm dịch vụ", value: rate(fc.done, fc.booked) },
  ];

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 [--heat:#2a78d6] dark:[--heat:#3987e5]">
      <h2 className="font-medium">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border px-3 py-2">
            <div className="text-xs text-muted-foreground">{c.label}</div>
            <div className="text-lg font-semibold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-1">
        {steps.map((step, i) => (
          <div key={step.label} className="grid gap-1">
            {i > 0 && (
              <div className="grid grid-cols-[9rem_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr_7rem_9rem]">
                <span />
                <span className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <ArrowDown className="size-3" />
                  {rate(step.value, steps[i - 1].value)} sang bước này
                </span>
              </div>
            )}
            <div className="grid grid-cols-[9rem_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr_7rem_9rem]">
              <div>
                <div className="text-sm font-medium">{step.label}</div>
                <div className="text-[11px] text-muted-foreground">{step.source}</div>
              </div>
              <div className="flex h-9 justify-center">
                <div
                  className="h-full rounded-md"
                  style={{
                    width: `${Math.max(step.value > 0 ? 2 : 0, (step.value / max) * 100)}%`,
                    backgroundColor: `color-mix(in oklab, var(--heat) ${STEP_SHADES[i]}%, transparent)`,
                  }}
                  title={`${step.label}: ${count(step.value)}`}
                />
              </div>
              <div className="text-right text-lg font-semibold tabular-nums max-sm:col-start-2 max-sm:text-left">
                {count(step.value)}
              </div>
              <div className="text-right text-xs text-muted-foreground tabular-nums max-sm:col-start-2 max-sm:text-left">
                {money(per(ad.spend, step.value))} / {step.label.toLowerCase()}
              </div>
            </div>
          </div>
        ))}
        <div className="mt-1 grid grid-cols-[9rem_1fr] items-center gap-3 sm:grid-cols-[11rem_1fr_7rem_9rem]">
          <div className="text-sm font-medium text-muted-foreground">Doanh thu</div>
          <div className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
            Sẽ có khi xây phân hệ Thu ngân (tính được doanh thu / chi tiêu quảng cáo)
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Lead tính theo ngày tạo lead; hẹn lịch và làm dịch vụ tính theo trạng thái hiện tại của các lead đó.
      </p>
    </section>
  );
}

function StaffFunnelTable({
  people,
  byStaff,
  leads,
  unattributed,
}: {
  people: AdsStaff[];
  byStaff: Map<string | null, Totals>;
  leads: (FunnelLead & { owner: string | null })[];
  unattributed: FunnelLead[];
}) {
  const rows = people
    .map((p) => ({
      person: p,
      ad: byStaff.get(p.id) ?? zero(),
      fc: funnelCounts(leads.filter((l) => l.owner === p.id), NOT_RECEIVED_STATUSES),
    }))
    .filter((r) => r.ad.spend > 0 || r.fc.leads > 0);
  const loose = funnelCounts(unattributed, NOT_RECEIVED_STATUSES);
  const best = (pick: (r: (typeof rows)[number]) => number | null) => {
    const values = rows.map(pick).filter((v): v is number => v !== null);
    return values.length >= 2 ? Math.min(...values) : null;
  };
  const bestLead = best((r) => per(r.ad.spend, r.fc.leads));
  const bestDone = best((r) => per(r.ad.spend, r.fc.done));
  const good = "bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100";

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Phễu theo nhân viên</h2>
        <p className="text-sm text-muted-foreground">Ô xanh: giá rẻ nhất nhóm.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b">
              <th className={FIRST_TH}>Nhân viên</th>
              {["Chi tiêu", "Mess", "Data", "Lead", "Hẹn lịch", "Làm dịch vụ", "Giá / lead", "Giá / khách làm DV", "Data → Hẹn"].map(
                (h) => (
                  <th key={h} className={cn(TH, "bg-muted")}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ person, ad, fc }) => {
              const perLead = per(ad.spend, fc.leads);
              const perDone = per(ad.spend, fc.done);
              return (
                <tr key={person.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{person.full_name}</td>
                  <td className={TD}>{count(ad.spend)}</td>
                  <td className={TD}>{count(ad.messages)}</td>
                  <td className={TD}>{count(ad.data)}</td>
                  <td className={TD}>{count(fc.leads)}</td>
                  <td className={TD}>{count(fc.booked)}</td>
                  <td className={TD}>{count(fc.done)}</td>
                  <td className={cn(TD, perLead !== null && perLead === bestLead && good)}>{money(perLead)}</td>
                  <td className={cn(TD, perDone !== null && perDone === bestDone && good)}>{money(perDone)}</td>
                  <td className={TD}>{rate(fc.booked, ad.data)}</td>
                </tr>
              );
            })}
            {loose.leads > 0 && (
              <tr className="border-b text-muted-foreground last:border-0">
                <td className="px-3 py-2" title="Lead không có Chiến dịch, hoặc chiến dịch chưa gắn TKQC">
                  Lead chưa gắn TKQC
                </td>
                <td className={TD} />
                <td className={TD} />
                <td className={TD} />
                <td className={TD}>{count(loose.leads)}</td>
                <td className={TD}>{count(loose.booked)}</td>
                <td className={TD}>{count(loose.done)}</td>
                <td className={TD} />
                <td className={TD} />
                <td className={TD} />
              </tr>
            )}
            {rows.length === 0 && loose.leads === 0 && (
              <tr>
                <td colSpan={10} className="h-20 text-center text-muted-foreground">
                  Khoảng ngày này chưa có số liệu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loose.leads > 0 && (
        <p className="text-xs text-muted-foreground">
          Lead chỉ tính được cho nhân viên Ads khi lúc dán số có chọn Chiến dịch, và chiến dịch đó có gắn TKQC.
        </p>
      )}
    </section>
  );
}
