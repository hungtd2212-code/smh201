"use client";

import { Crown, Medal } from "lucide-react";
import { useEffect, useState } from "react";
import { StaffAvatar } from "@/components/staff/staff-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { BOARD_MIN_SHARE, scoreBoard, type BoardScore } from "@/lib/ad-reports/aggregate";
import { monthLabel } from "@/lib/ad-reports/dates";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isNotMigrated } from "@/lib/supabase/errors";
import { cn } from "@/lib/utils";

/**
 * Vinh danh top 3 nhân viên Ads của tháng (bục nhận cúp vàng / bạc / đồng) + tiến độ từng người.
 * Điểm 0 → 100 tính từ 3 tiêu chí: tỉ lệ chi phí ads / doanh thu, giá số, số điện thoại so với target.
 * Số liệu cả nhóm lấy qua hàm ads_leaderboard (file 013) để nhân viên Ads cũng xem được bảng vinh danh.
 */

export type BoardRow = {
  ads_staff_id: string;
  full_name: string;
  avatar_url: string | null;
  is_active: boolean;
  spend: number;
  messages: number;
  data_count: number;
  revenue: number;
  data_target: number | null;
  max_cost_per_data: number | null;
};

type BoardState =
  | { status: "loading" }
  | { status: "ready"; rows: BoardRow[] }
  | { status: "not-migrated" }
  | { status: "error"; message: string };

export function useLeaderboard(month: string) {
  const [loaded, setLoaded] = useState<{ month: string; state: BoardState } | null>(null);
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    getSupabaseBrowserClient()
      .rpc("ads_leaderboard", { p_month: `${month}-01` })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoaded({ month, state: isNotMigrated(error) ? { status: "not-migrated" } : { status: "error", message: error.message } });
          return;
        }
        const rows = (data as BoardRow[]).map((r) => ({
          ...r,
          spend: Number(r.spend),
          messages: Number(r.messages),
          data_count: Number(r.data_count),
          revenue: Number(r.revenue),
        }));
        setLoaded({ month, state: { status: "ready", rows } });
      });
    return () => {
      cancelled = true;
    };
  }, [month]);
  return loaded?.month === month ? loaded.state : ({ status: "loading" } as BoardState);
}

const RANK = [
  { label: "Hạng nhất", cup: ["#fde68a", "#f5b301", "#b7791f"], ring: "ring-amber-400", stand: "min-h-36", tint: "bg-amber-50 dark:bg-amber-950/40" },
  { label: "Hạng nhì", cup: ["#f1f5f9", "#b8c2cc", "#7b8794"], ring: "ring-slate-400", stand: "min-h-28", tint: "bg-slate-50 dark:bg-slate-900/50" },
  { label: "Hạng ba", cup: ["#fed7aa", "#d9822b", "#9a4f12"], ring: "ring-orange-400", stand: "min-h-24", tint: "bg-orange-50 dark:bg-orange-950/40" },
];

/** Chiếc cúp (vàng / bạc / đồng) có số hạng. */
export function Cup({ rank, className }: { rank: 0 | 1 | 2; className?: string }) {
  const [light, mid, dark] = RANK[rank].cup;
  const id = `cup-${rank}`;
  return (
    <svg viewBox="0 0 64 64" className={cn("size-14 drop-shadow", className)} role="img" aria-label={`Cúp ${RANK[rank].label}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={light} />
          <stop offset="55%" stopColor={mid} />
          <stop offset="100%" stopColor={dark} />
        </linearGradient>
      </defs>
      <path d="M14 10h36v8c0 11-7 19-18 21-11-2-18-10-18-21z" fill={`url(#${id})`} />
      <path d="M14 14H7v4c0 7 5 12 11 12" fill="none" stroke={mid} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M50 14h7v4c0 7-5 12-11 12" fill="none" stroke={mid} strokeWidth="3.5" strokeLinecap="round" />
      <rect x="28" y="38" width="8" height="9" fill={dark} />
      <rect x="20" y="46" width="24" height="7" rx="2" fill={`url(#${id})`} />
      <rect x="16" y="52" width="32" height="5" rx="1.5" fill={dark} />
      <text x="32" y="29" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" style={{ paintOrder: "stroke" }} stroke={dark} strokeWidth="1">
        {rank + 1}
      </text>
    </svg>
  );
}

const money = (n: number | null) => (n === null ? "–" : `${Math.round(n).toLocaleString("vi-VN")}đ`);
const pct = (n: number | null, digits = 1) => (n === null ? "–" : `${n.toLocaleString("vi-VN", { maximumFractionDigits: digits })}%`);

function Stats({ s, row }: { s: BoardScore; row: BoardRow }) {
  return (
    // Cột bục trên điện thoại chỉ rộng ~100px → xếp dọc từng chỉ số; màn hình rộng mới xếp ba cột.
    <dl className="grid w-full gap-1.5 text-center text-[11px] leading-tight lg:grid-cols-3 lg:gap-1">
      <div>
        <dt className="text-muted-foreground">Ads / DT</dt>
        <dd className="font-semibold tabular-nums">{pct(s.adRevenuePct)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Giá số</dt>
        <dd className="font-semibold tabular-nums">{money(s.costPerData)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Số / target</dt>
        <dd className="font-semibold tabular-nums">
          {row.data_target ? `${row.data_count.toLocaleString("vi-VN")}/${row.data_target.toLocaleString("vi-VN")}` : "–"}
        </dd>
      </div>
    </dl>
  );
}

export function Leaderboard({ month, elapsed, state }: { month: string; elapsed: number; state: BoardState }) {
  if (state.status === "loading") return <Skeleton className="h-80 w-full rounded-xl" />;
  if (state.status === "not-migrated") {
    return (
      <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Bảng vinh danh cần chạy file supabase/013_revenue_avatars.sql trên Supabase trước.
      </p>
    );
  }
  if (state.status === "error") return <p className="text-sm text-destructive">{state.message}</p>;

  const byId = new Map(state.rows.map((r) => [r.ads_staff_id, r]));
  const scores = scoreBoard(
    state.rows.map((r) => ({ id: r.ads_staff_id, spend: r.spend, data: r.data_count, revenue: r.revenue, dataTarget: r.data_target })),
    elapsed,
  );
  const top = scores.slice(0, 3);
  // Bục: hạng nhì bên trái, hạng nhất ở giữa, hạng ba bên phải.
  const podium = [top[1], top[0], top[2]].map((s, i) => (s ? { s, rank: ([1, 0, 2] as const)[i] } : null));
  const best = (pick: (s: BoardScore) => number | null, lower: boolean) =>
    scores
      .filter((s) => pick(s) !== null)
      .sort((a, b) => (lower ? (pick(a) ?? 0) - (pick(b) ?? 0) : (pick(b) ?? 0) - (pick(a) ?? 0)))[0];
  const awards = [
    { title: "Tỉ lệ ads / doanh số tốt nhất", s: best((x) => x.adRevenuePct, true), value: (x: BoardScore) => pct(x.adRevenuePct) },
    { title: "Giá số rẻ nhất", s: best((x) => x.costPerData, true), value: (x: BoardScore) => money(x.costPerData) },
    { title: "Vượt target số cao nhất", s: best((x) => x.targetPace, false), value: (x: BoardScore) => `${Math.round((x.targetPace ?? 0) * 100)}% nhịp` },
  ];

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Crown className="size-5 text-amber-500" />
          Vinh danh {monthLabel(month).toLowerCase()}
        </h2>
        <p className="text-sm text-muted-foreground">
          Điểm 0–100: tỉ lệ ads / doanh số · giá số · số điện thoại so với target (người tốt nhất mỗi tiêu chí = 100).
          Chỉ xếp hạng người chi tiêu từ {Math.round(BOARD_MIN_SHARE * 100)}% mức trung bình của nhóm trở lên.
        </p>
      </div>
      {top.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Tháng này chưa có nhân viên nào chạy quảng cáo.</p>
      ) : (
        <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
          {podium.map((p, i) =>
            p ? (
              <div key={p.s.id} className="grid justify-items-center gap-2">
                <Cup rank={p.rank} className={p.rank === 0 ? "size-16 sm:size-20" : "size-12 sm:size-14"} />
                <StaffAvatar
                  name={byId.get(p.s.id)?.full_name ?? "?"}
                  url={byId.get(p.s.id)?.avatar_url}
                  className={cn("ring-4", RANK[p.rank].ring, p.rank === 0 ? "size-20 text-xl" : "size-16 text-lg")}
                />
                <div className="text-center">
                  <div className="font-semibold">{byId.get(p.s.id)?.full_name}</div>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground tabular-nums">{p.s.score.toLocaleString("vi-VN")}</span> điểm
                  </div>
                </div>
                <div className={cn("grid w-full content-start justify-items-center gap-2 rounded-t-xl px-2 pt-3 pb-2", RANK[p.rank].tint, RANK[p.rank].stand)}>
                  <span className="text-xs font-semibold tracking-wide uppercase">{RANK[p.rank].label}</span>
                  {byId.get(p.s.id) && <Stats s={p.s} row={byId.get(p.s.id) as BoardRow} />}
                </div>
              </div>
            ) : (
              <div key={`empty-${i}`} />
            ),
          )}
        </div>
      )}
      {scores.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {awards.map((a) =>
            a.s ? (
              <div key={a.title} className="flex items-center gap-3 rounded-lg border px-3 py-2">
                <Medal className="size-5 shrink-0 text-amber-500" />
                <StaffAvatar name={byId.get(a.s.id)?.full_name ?? "?"} url={byId.get(a.s.id)?.avatar_url} />
                <div className="min-w-0">
                  <div className="truncate text-xs text-muted-foreground">{a.title}</div>
                  <div className="truncate text-sm font-semibold">
                    {byId.get(a.s.id)?.full_name} · <span className="tabular-nums">{a.value(a.s)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div key={a.title} className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                {a.title}: chưa có số ({a.title.includes("doanh số") ? "chưa nhập doanh số" : "chưa đặt target"})
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

/** Tiến độ của từng người trong tháng (Quản trị / Trưởng Marketing). */
export function StaffProgress({ state, elapsed }: { state: BoardState; elapsed: number }) {
  if (state.status !== "ready") return null;
  const scores = new Map(
    scoreBoard(
      state.rows.map((r) => ({ id: r.ads_staff_id, spend: r.spend, data: r.data_count, revenue: r.revenue, dataTarget: r.data_target })),
      elapsed,
    ).map((s) => [s.id, s]),
  );
  const rows = state.rows
    .filter((r) => r.is_active || r.spend > 0)
    .map((r) => {
      const share = r.data_target ? r.data_count / r.data_target : null;
      const pace = r.data_target && elapsed > 0 ? r.data_count / (r.data_target * elapsed) : null;
      const [badge, tone] =
        share === null
          ? ["Chưa đặt target", "bg-muted text-muted-foreground"]
          : share >= 1
            ? ["Đã đạt", "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"]
            : (pace ?? 0) >= 0.95
              ? ["Đúng nhịp", "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"]
              : (pace ?? 0) >= 0.8
                ? ["Có nguy cơ", "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200"]
                : ["Chậm", "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200"];
      const cost = r.data_count > 0 ? r.spend / r.data_count : null;
      return { r, share, badge, tone, cost, score: scores.get(r.ads_staff_id)?.score ?? null };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="grid gap-0.5">
        <h2 className="font-medium">Tiến độ từng nhân viên</h2>
        <p className="text-sm text-muted-foreground">
          Thanh: số điện thoại so với target tháng. Nhãn: so với nhịp tới hôm nay. Giá số đỏ = vượt giá tối đa.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map(({ r, share, badge, tone, cost, score }) => (
          <li key={r.ads_staff_id} className="grid grid-cols-[auto_1fr] items-center gap-3">
            <StaffAvatar name={r.full_name} url={r.avatar_url} className="size-10" />
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{r.full_name}</span>
                <span className="flex items-center gap-2">
                  {share !== null && <span className="font-semibold tabular-nums">{Math.round(share * 100)}%</span>}
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{badge}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", badge === "Chậm" ? "bg-red-500" : badge === "Có nguy cơ" ? "bg-amber-500" : "bg-emerald-500")}
                  style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                <span>
                  Số: {r.data_count.toLocaleString("vi-VN")}
                  {r.data_target ? `/${r.data_target.toLocaleString("vi-VN")}` : ""}
                </span>
                <span className={cn(cost !== null && r.max_cost_per_data && cost > r.max_cost_per_data && "font-semibold text-red-600 dark:text-red-400")}>
                  Giá số: {money(cost)}
                </span>
                <span>Ads/DT: {r.revenue > 0 ? pct((r.spend / r.revenue) * 100) : "–"}</span>
                {score !== null && <span>Điểm: {score.toLocaleString("vi-VN")}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
