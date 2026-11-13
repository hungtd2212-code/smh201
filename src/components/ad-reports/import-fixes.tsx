"use client";

import { ExternalLink, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  dayRanges,
  type AccountMismatch,
  type Mismatch,
  type OwnerMismatch,
  type StaffMismatch,
} from "@/lib/ad-reports/import";
import {
  ACCOUNT_KIND_LABELS,
  PAYMENT_KIND_LABELS,
  type AdAccountKind,
  type AdPaymentKind,
  type AdsStaff,
} from "@/lib/catalog/types";

/**
 * Các chỗ chưa khớp sau khi bấm "Khớp dữ liệu", mỗi chỗ kèm gợi ý và nút sửa ngay:
 *   • Tên nhân viên chưa có → dùng người có tên gần giống / chọn người có sẵn / tạo nhân viên Ads mới.
 *   • TKQC chưa có (theo ID) → tạo TKQC cho đúng người ở tab đó.
 *   • TKQC có nhưng người phụ trách ngày đó khác → mở TKQC & Page để sửa phân công.
 */

export type FixHandlers = {
  /** Đang chạy một việc (khớp / tạo) → khoá các nút. */
  busy: boolean;
  staff: AdsStaff[];
  onUseStaff: (key: string, staffId: string) => void;
  onCreateStaff: (key: string, name: string, active: boolean) => Promise<void>;
  onCreateAccount: (
    mismatch: AccountMismatch,
    values: { accountNo: string; accountKind: AdAccountKind; paymentKind: AdPaymentKind; stopped: boolean },
  ) => Promise<void>;
};

const sheetsText = (sheets: string[]) => `tab ${sheets.map((s) => `“${s}”`).join(", ")}`;

export function MismatchList({ mismatches, ...handlers }: FixHandlers & { mismatches: Mismatch[] }) {
  return (
    <div className="grid gap-2">
      {mismatches.map((m) =>
        m.kind === "staff" ? (
          <StaffFix key={`s-${m.key}`} mismatch={m} {...handlers} />
        ) : m.kind === "account" ? (
          <AccountFix key={`a-${m.key}`} mismatch={m} {...handlers} />
        ) : (
          <OwnerFix key={`o-${m.key}`} mismatch={m} />
        ),
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 rounded-lg border border-amber-300/70 bg-amber-50/60 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-950/20">{children}</div>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function StaffFix({ mismatch: m, busy, staff, onUseStaff, onCreateStaff }: FixHandlers & { mismatch: StaffMismatch }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(m.name);
  const [left, setLeft] = useState(false);
  const others = staff.filter((p) => !m.suggestions.some((s) => s.id === p.id));
  return (
    <Card>
      <p>
        <b>Nhân viên “{m.name}”</b> chưa có trong phần mềm <span className="text-muted-foreground">({sheetsText(m.sheets)})</span>.
      </p>
      <Hint>
        Gợi ý:{" "}
        {m.suggestions.length > 0
          ? `có phải ${m.suggestions.map((s) => `“${s.name}”`).join(" hoặc ")}? Bấm để dùng người đó, hoặc tạo nhân viên Ads mới.`
          : "tạo thêm nhân viên Ads mới, hoặc chọn người có sẵn nếu chỉ là ghi tên khác."}
      </Hint>
      <div className="flex flex-wrap items-center gap-2">
        {m.suggestions.map((s) => (
          <Button key={s.id} size="sm" disabled={busy} onClick={() => onUseStaff(m.key, s.id)}>
            Dùng “{s.name}”
          </Button>
        ))}
        {others.length > 0 && (
          <Select value="" onValueChange={(id) => onUseStaff(m.key, id)} disabled={busy}>
            <SelectTrigger size="sm" className="w-48" aria-label={`Chọn nhân viên có sẵn cho tên ${m.name}`}>
              <SelectValue placeholder="Chọn người có sẵn…" />
            </SelectTrigger>
            <SelectContent>
              {others.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name}
                  {!p.is_active && " (đã nghỉ)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!creating && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setCreating(true)}>
            <UserPlus />
            Tạo nhân viên Ads mới
          </Button>
        )}
      </div>
      {creating && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-background p-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-56"
            aria-label="Họ tên nhân viên Ads mới"
            maxLength={120}
          />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="size-4 accent-primary" checked={left} onChange={(e) => setLeft(e.target.checked)} />
            Đã nghỉ
          </label>
          <Button size="sm" disabled={busy || !name.trim()} onClick={() => void onCreateStaff(m.key, name, !left)}>
            Tạo
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
            Huỷ
          </Button>
        </div>
      )}
    </Card>
  );
}

function AccountFix({ mismatch: m, busy, onCreateAccount }: FixHandlers & { mismatch: AccountMismatch }) {
  const [creating, setCreating] = useState(false);
  const [accountNo, setAccountNo] = useState(m.accountNo ?? "");
  const [kind, setKind] = useState<AdAccountKind | "">("");
  const [payment, setPayment] = useState<AdPaymentKind | "">("");
  const [stopped, setStopped] = useState(false);
  const validNo = /^\d{5,30}$/.test(accountNo.replace(/\s/g, ""));
  return (
    <Card>
      <p>
        <b>TKQC “{m.name}”</b>
        {m.accountNo ? ` (ID ${m.accountNo})` : " (file không ghi ID)"} chưa có trong phần mềm{" "}
        <span className="text-muted-foreground">
          ({sheetsText(m.sheets)}, {m.days.length} ngày: {dayRanges(m.days)})
        </span>
        .
      </p>
      <Hint>
        Gợi ý: tạo thêm TKQC này cho <b className="text-foreground">{m.staffName}</b>
        {m.accountNo ? "." : " — cần nhập ID tài khoản quảng cáo (nên ghi thêm ID vào dòng “ID TKQC” của file)."}
      </Hint>
      {!creating ? (
        <div>
          <Button size="sm" disabled={busy} onClick={() => setCreating(true)}>
            <Plus />
            Tạo TKQC này
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 rounded-md bg-background p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={accountNo}
              onChange={(event) => setAccountNo(event.target.value)}
              readOnly={m.accountNo !== null}
              placeholder="ID tài khoản, vd 123456789012345"
              inputMode="numeric"
              className="h-8 w-56"
              aria-label={`ID tài khoản quảng cáo của TKQC ${m.name}`}
            />
            <Select value={kind} onValueChange={(v) => setKind(v as AdAccountKind)} disabled={busy}>
              <SelectTrigger size="sm" className="w-36" aria-label="Loại tài khoản">
                <SelectValue placeholder="Loại TK…" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACCOUNT_KIND_LABELS) as AdAccountKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ACCOUNT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={payment} onValueChange={(v) => setPayment(v as AdPaymentKind)} disabled={busy}>
              <SelectTrigger size="sm" className="w-44" aria-label="Thanh toán">
                <SelectValue placeholder="Thanh toán…" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_KIND_LABELS) as AdPaymentKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {PAYMENT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="size-4 accent-primary" checked={stopped} onChange={(e) => setStopped(e.target.checked)} />
            TKQC này đã ngừng chạy (không hiện ở trang Nhập liệu)
          </label>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !validNo || !kind || !payment}
              onClick={() =>
                kind &&
                payment &&
                void onCreateAccount(m, { accountNo: accountNo.replace(/\s/g, ""), accountKind: kind, paymentKind: payment, stopped })
              }
            >
              Tạo TKQC cho {m.staffName}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
              Huỷ
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function OwnerFix({ mismatch: m }: { mismatch: OwnerMismatch }) {
  return (
    <Card>
      <p>
        <b>TKQC “{m.accountName}”</b>
        {m.accountNo && ` (ID ${m.accountNo})`} ngày {dayRanges(m.days)}{" "}
        {m.ownerName ? (
          <>
            do <b>{m.ownerName}</b> phụ trách
          </>
        ) : (
          "chưa có ai phụ trách"
        )}
        , nhưng số nằm ở tab của <b>{m.staffName}</b> <span className="text-muted-foreground">({sheetsText(m.sheets)})</span>.
      </p>
      <Hint>
        Gợi ý:{" "}
        {m.ownerName
          ? `chuyển cột này sang tab của ${m.ownerName}, hoặc sửa người phụ trách ở TKQC & Page`
          : `thêm ngày phụ trách cho ${m.staffName} ở TKQC & Page`}
        , rồi bấm “Khớp dữ liệu” lại.
      </Hint>
      <div>
        <Button asChild size="sm" variant="outline">
          <a href="/marketing/cai-dat?tab=tkqc" target="_blank" rel="noreferrer">
            <ExternalLink />
            Mở TKQC & Page
          </a>
        </Button>
      </div>
    </Card>
  );
}
