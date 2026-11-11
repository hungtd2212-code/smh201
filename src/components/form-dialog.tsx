"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Hộp thoại thêm / sửa dùng chung cho các danh mục (kênh, page, chiến dịch, dịch vụ).
 * Mỗi trang chỉ cần khai báo danh sách ô nhập.
 */

/** Giá trị đại diện cho "không chọn" (Select không nhận chuỗi rỗng). */
export const NONE = "__none";

export type FormValues = Record<string, string | boolean>;

type Option = { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  /** Chiếm cả hai cột. */
  wide?: boolean;
} & (
  | { type: "text" | "number" | "date" }
  | { type: "checkbox"; text: string }
  /** Tick nhiều lựa chọn; giá trị là các `value` nối nhau bằng dấu phẩy. */
  | { type: "checks"; options: Option[]; emptyText?: string }
  | {
      type: "select";
      /** Danh sách lựa chọn, có thể phụ thuộc các ô khác (vd page theo kênh). */
      options: Option[] | ((values: FormValues) => Option[]);
      /** Nhãn cho lựa chọn "không chọn"; bỏ trống = bắt buộc chọn. */
      emptyLabel?: string;
      /** Khi đổi ô này thì đặt lại các ô phụ thuộc. */
      resets?: string[];
    }
);

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDef[];
  initialValues: FormValues;
  onSubmit: (values: FormValues) => Promise<void>;
  submitLabel?: string;
};

export function FormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl">
        {/* Mỗi lần mở là một form mới với giá trị ban đầu mới. */}
        {props.open && <FormBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function FormBody({
  title,
  description,
  fields,
  initialValues,
  onSubmit,
  onOpenChange,
  submitLabel = "Lưu",
}: Props) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function set(field: FieldDef, value: string | boolean) {
    setValues((prev) => {
      const next = { ...prev, [field.name]: value };
      if (field.type === "select") for (const dep of field.resets ?? []) next[dep] = NONE;
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.name];
      const empty = value === undefined || value === "" || value === NONE;
      if (field.required && empty) nextErrors[field.name] = "Bắt buộc";
      if (field.type === "number" && !empty && !(Number(value) >= 0))
        nextErrors[field.name] = "Phải là số không âm";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      toast.error("Không lưu được", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `field-${field.name}`;
          const value = values[field.name];
          const error = errors[field.name];

          return (
            <div key={field.name} className={field.wide ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}>
              {field.type !== "checkbox" && (
                <Label htmlFor={id}>
                  {field.label}
                  {field.required && " *"}
                </Label>
              )}

              {field.type === "select" ? (
                <Select value={String(value ?? NONE)} onValueChange={(v) => set(field, v)}>
                  <SelectTrigger id={id} className="w-full" aria-invalid={Boolean(error)}>
                    <SelectValue placeholder="Chọn…" />
                  </SelectTrigger>
                  <SelectContent>
                    {field.emptyLabel && <SelectItem value={NONE}>{field.emptyLabel}</SelectItem>}
                    {(typeof field.options === "function" ? field.options(values) : field.options).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === "checks" ? (
                field.options.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{field.emptyText ?? "Chưa có lựa chọn nào."}</p>
                ) : (
                  <div className="grid gap-1.5 rounded-md border p-2.5 sm:grid-cols-2">
                    {field.options.map((option) => {
                      const picked = toIds(value);
                      return (
                        <label key={option.value} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={picked.includes(option.value)}
                            onChange={(e) =>
                              set(
                                field,
                                (e.target.checked
                                  ? [...picked, option.value]
                                  : picked.filter((v) => v !== option.value)
                                ).join(","),
                              )
                            }
                          />
                          {option.label}
                        </label>
                      );
                    })}
                  </div>
                )
              ) : field.type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    id={id}
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={Boolean(value)}
                    onChange={(e) => set(field, e.target.checked)}
                  />
                  {field.text}
                </label>
              ) : (
                <Input
                  id={id}
                  type={field.type}
                  inputMode={field.type === "number" ? "numeric" : undefined}
                  min={field.type === "number" ? 0 : undefined}
                  placeholder={field.placeholder}
                  value={String(value ?? "")}
                  onChange={(e) => set(field, e.target.value)}
                  aria-invalid={Boolean(error)}
                />
              )}

              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          );
        })}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Huỷ
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Đang lưu…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Các hàm đổi giá trị form sang giá trị lưu xuống cơ sở dữ liệu. */
export const toText = (v: string | boolean | undefined) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
export const toId = (v: string | boolean | undefined) =>
  typeof v === "string" && v && v !== NONE ? v : null;
export const toNumber = (v: string | boolean | undefined) =>
  typeof v === "string" && v.trim() !== "" ? Number(v) : null;
/** Giá trị của ô "checks" → danh sách các lựa chọn đã tick. */
export function toIds(v: string | boolean | undefined): string[] {
  return typeof v === "string" && v ? v.split(",").filter(Boolean) : [];
}
