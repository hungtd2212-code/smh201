"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { formatNumber } from "@/lib/ad-reports/number";
import {
  DATA_MAX_DIGITS,
  REPORT_FIELDS,
  REVENUE_MAX_DIGITS,
  type ReportField,
  type ReportValues,
} from "@/lib/ad-reports/types";
import type { AdAccount } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { NumberInput } from "./number-input";

/** Một TK ADS trong bảng nhập: có `shown` thì chỉ xem (đã gửi / đã khoá), không thì nhập được. */
export type FieldItem = {
  account: AdAccount;
  /** Số thứ tự: TK ADS 1, TK ADS 2… */
  index: number;
  /** Số hiện ở dạng chỉ xem. */
  shown?: Record<ReportField, number>;
  /** Dòng nhỏ dưới tên TK ADS, vd "Đã gửi lúc 09:15", "Đã khoá". */
  note?: string;
};

export const REQUIRED_TEXT = "Bắt buộc nhập, tối thiểu 0";

/** Dòng "Data xin được" chung bên dưới các TKQC. */
export type DataRow = {
  value: string;
  /** Có giá trị = chỉ xem (đã gửi / đã khoá). */
  shown?: number;
  /** vd "Đã gửi lúc 09:15", "Đã khoá". */
  note?: string;
  touched: boolean;
  onChange: (digits: string) => void;
  onTouch: () => void;
  /** Ô "Doanh số theo ngày" bên cạnh (không bắt buộc). Bỏ trống = không hiện (chưa chạy file 018). */
  revenue?: RevenueCell;
};

/** Ô "Doanh số theo ngày": không bắt buộc, để trống được. */
export type RevenueCell = {
  value: string;
  /** Có = chỉ xem (đã gửi / đã khoá); null = đã gửi nhưng để trống. */
  shown?: number | null;
  onChange: (digits: string) => void;
};

const DATA_LABEL = "Data xin được";
const DATA_HINT = "Tổng số điện thoại xin được trong ngày của tất cả TKQC (lấy từ trực page).";
const REVENUE_LABEL = "Doanh số theo ngày";
const REVENUE_HINT = "Không bắt buộc — chưa biết thì để trống, vào Tổng quan bổ sung trong 24 giờ.";

const fieldKey = (accountId: string, field: ReportField) => `${accountId}:${field}`;

type Props = {
  items: FieldItem[];
  values: Record<string, ReportValues>;
  /** Các ô đã bấm vào rồi rời đi ("idTKQC:tên ô"). */
  touched: Set<string>;
  onChange: (accountId: string, field: ReportField, digits: string) => void;
  onTouch: (accountId: string, field: ReportField) => void;
  /** "table": bảng như Google Sheet trên màn hình rộng, thẻ trên điện thoại. "cards": luôn là thẻ. */
  layout: "table" | "cards";
  /** Cột "Ngày" của bảng. */
  dayLabel: string;
  /** Dòng "Data xin được" chung (bỏ trống = không hiện). */
  data?: DataRow;
};

function GroupHead({ item, className }: { item: FieldItem; className?: string }) {
  return (
    <div className={cn("bg-emerald-100 text-emerald-950 dark:bg-emerald-900/50 dark:text-emerald-50", className)}>
      <div className="text-[11px] font-semibold tracking-wide uppercase opacity-75">TK ADS {item.index}</div>
      <div className="font-semibold">{item.account.name}</div>
      {item.note && <div className="text-xs font-normal opacity-80">{item.note}</div>}
    </div>
  );
}

function Required() {
  return (
    <span className="text-destructive" aria-hidden>
      {" "}
      *
    </span>
  );
}

/** Ô chỉ xem (số đã gửi / đã khoá). null = để trống ("–"). */
function ShownValue({ value, suffix }: { value: number | null; suffix?: string }) {
  return (
    <div className="flex h-9 items-center justify-end rounded-lg border border-dashed px-2.5 text-sm tabular-nums">
      {value === null ? (
        <span className="text-muted-foreground">–</span>
      ) : (
        <>
          {formatNumber(value)}
          {suffix && <span className="ml-1 text-muted-foreground">{suffix}</span>}
        </>
      )}
    </div>
  );
}

/**
 * Bảng / thẻ nhập: mỗi TK ADS hai ô (Chi tiêu, Số lượng tin nhắn), bên dưới một dòng chung cho cả ngày:
 * "Data xin được" (bắt buộc) và bên cạnh là "Doanh số theo ngày" (không bắt buộc).
 */
export function ReportFields({ items, values, touched, onChange, onTouch, layout, dayLabel, data }: Props) {
  // Mã riêng cho từng bảng nhập: trên cùng một trang có thể có hai bảng (vd hộp Sửa mở trên trang).
  const uid = useId();
  const cell = (item: FieldItem, field: (typeof REPORT_FIELDS)[number], prefix: string, withLabel: boolean) => {
    const id = `${uid}${prefix}-${item.account.id}-${field.key}`;
    if (item.shown) {
      return <ShownValue value={item.shown[field.key]} suffix={field.suffix} />;
    }
    const value = values[item.account.id]?.[field.key] ?? "";
    const missing = value === "" && touched.has(fieldKey(item.account.id, field.key));
    return (
      <>
        <NumberInput
          id={id}
          value={value}
          maxDigits={field.maxDigits}
          suffix={field.suffix}
          invalid={missing}
          label={withLabel ? undefined : `${field.label} — ${item.account.name}`}
          describedBy={missing ? `${id}-error` : undefined}
          onValueChange={(digits) => onChange(item.account.id, field.key, digits)}
          onBlur={() => onTouch(item.account.id, field.key)}
        />
        {missing && (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {REQUIRED_TEXT}
          </p>
        )}
      </>
    );
  };

  const dataInput = (prefix: string, withLabel: boolean) => {
    if (!data) return null;
    if (data.shown !== undefined) return <ShownValue value={data.shown} />;
    const id = `${uid}${prefix}-data`;
    const missing = data.value === "" && data.touched;
    return (
      <>
        <NumberInput
          id={id}
          value={data.value}
          maxDigits={DATA_MAX_DIGITS}
          invalid={missing}
          label={withLabel ? undefined : DATA_LABEL}
          describedBy={missing ? `${id}-error` : undefined}
          onValueChange={data.onChange}
          onBlur={data.onTouch}
        />
        {missing && (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {REQUIRED_TEXT}
          </p>
        )}
      </>
    );
  };

  const revenue = data?.revenue;
  const revenueInput = (prefix: string, withLabel: boolean) => {
    if (!revenue) return null;
    if (revenue.shown !== undefined) return <ShownValue value={revenue.shown} suffix="đ" />;
    return (
      <NumberInput
        id={`${uid}${prefix}-revenue`}
        value={revenue.value}
        maxDigits={REVENUE_MAX_DIGITS}
        suffix="đ"
        label={withLabel ? undefined : REVENUE_LABEL}
        onValueChange={revenue.onChange}
      />
    );
  };
  const revenueHint = revenue && revenue.shown === undefined ? REVENUE_HINT : null;

  const cards = (
    <div className={cn("grid gap-3", layout === "table" && "md:hidden")}>
      {items.map((item) => (
        <section key={item.account.id} className="overflow-hidden rounded-xl border bg-card">
          <GroupHead item={item} className="px-3 py-2" />
          <div className={cn("grid gap-3 p-3", layout === "cards" && "sm:grid-cols-2")}>
            {REPORT_FIELDS.map((field) => (
              <div key={field.key} className="grid content-start gap-1.5">
                <Label htmlFor={`${uid}c-${item.account.id}-${field.key}`}>
                  {field.label}
                  {!item.shown && <Required />}
                </Label>
                {cell(item, field, "c", true)}
              </div>
            ))}
          </div>
        </section>
      ))}
      {data && (
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="bg-sky-100 px-3 py-2 text-sky-950 dark:bg-sky-900/50 dark:text-sky-50">
            <div className="font-semibold">{revenue ? "Cả ngày" : DATA_LABEL}</div>
            <div className="text-xs opacity-80">{data.note ?? "Chung cho tất cả TKQC"}</div>
          </div>
          {revenue ? (
            // Hai ô cạnh nhau: Data xin được | Doanh số theo ngày.
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 sm:max-w-xl">
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`${uid}c-data`}>
                  {DATA_LABEL}
                  {data.shown === undefined && <Required />}
                </Label>
                {dataInput("c", true)}
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`${uid}c-revenue`}>{REVENUE_LABEL}</Label>
                {revenueInput("c", true)}
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                {DATA_HINT}
                {revenueHint && <> {revenueHint}</>}
              </p>
            </div>
          ) : (
            <div className="grid gap-1.5 p-3 sm:max-w-xs">
              <Label htmlFor={`${uid}c-data`}>
                {DATA_LABEL}
                {data.shown === undefined && <Required />}
              </Label>
              {dataInput("c", true)}
              <p className="text-xs text-muted-foreground">{DATA_HINT}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );

  if (layout === "cards") return cards;

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th rowSpan={2} className="border-b bg-muted px-3 py-2 text-left align-bottom font-medium">
                Ngày
              </th>
              {items.map((item) => (
                <th
                  key={item.account.id}
                  colSpan={REPORT_FIELDS.length}
                  className="border-b border-l p-0 text-left font-normal"
                >
                  <GroupHead item={item} className="px-3 py-2" />
                </th>
              ))}
            </tr>
            <tr className="border-b bg-emerald-50 dark:bg-emerald-950/40">
              {items.flatMap((item) =>
                REPORT_FIELDS.map((field, j) => (
                  <th
                    key={`${item.account.id}-${field.key}`}
                    className={cn("px-2 py-1.5 text-left text-xs font-medium whitespace-nowrap", j === 0 && "border-l")}
                  >
                    {field.label}
                    {!item.shown && <Required />}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-3 py-2.5 align-top font-medium whitespace-nowrap tabular-nums">{dayLabel}</td>
              {items.flatMap((item) =>
                REPORT_FIELDS.map((field, j) => (
                  <td
                    key={`${item.account.id}-${field.key}`}
                    className={cn("min-w-36 px-2 py-2 align-top", j === 0 && "border-l", field.key === "spend" && "min-w-40")}
                  >
                    <div className="grid gap-1">{cell(item, field, "t", false)}</div>
                  </td>
                )),
              )}
            </tr>
            {data && (
              <tr className="border-t bg-sky-50/70 dark:bg-sky-950/30">
                <td className="px-3 py-2.5 align-top font-medium whitespace-nowrap">
                  {revenue ? "Cả ngày" : DATA_LABEL}
                  {!revenue && data.shown === undefined && <Required />}
                  <div className="text-xs font-normal text-muted-foreground">{data.note ?? "Chung cho tất cả TKQC"}</div>
                </td>
                <td colSpan={items.length * REPORT_FIELDS.length} className="border-l px-2 py-2 align-top">
                  {revenue ? (
                    <div className="grid max-w-xl grid-cols-2 gap-x-3 gap-y-1">
                      <Label htmlFor={`${uid}t-data`} className="text-xs">
                        {DATA_LABEL}
                        {data.shown === undefined && <Required />}
                      </Label>
                      <Label htmlFor={`${uid}t-revenue`} className="text-xs">
                        {REVENUE_LABEL}
                      </Label>
                      <div className="grid content-start gap-1">{dataInput("t", true)}</div>
                      <div className="grid content-start gap-1">{revenueInput("t", true)}</div>
                      <p className="col-span-2 text-xs text-muted-foreground">
                        {DATA_HINT}
                        {revenueHint && <> {revenueHint}</>}
                      </p>
                    </div>
                  ) : (
                    <div className="grid max-w-xs gap-1">
                      {dataInput("t", false)}
                      <p className="text-xs text-muted-foreground">{DATA_HINT}</p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cards}
    </>
  );
}

/** Đủ giá trị cho mọi ô nhập được chưa (nhập 0 là hợp lệ). */
export const allFilled = (items: FieldItem[], values: Record<string, ReportValues>) =>
  items.every((item) => item.shown || REPORT_FIELDS.every((field) => (values[item.account.id]?.[field.key] ?? "") !== ""));

/** Chuỗi chữ số → số để lưu. */
export const toNumbers = (value: ReportValues): Record<ReportField, number> => ({
  spend: Number(value.spend),
  messages: Number(value.messages),
});

export { fieldKey };
