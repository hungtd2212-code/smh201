"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { groupThousands, isNumberText, normalizeInput } from "@/lib/ad-reports/number";
import { cn } from "@/lib/utils";

/**
 * Ô nhập số nguyên ≥ 0 có dấu chấm hàng nghìn. `value` là chuỗi chữ số ("" = chưa nhập).
 *   • Chỉ nhận chữ số; dấu chấm / phẩy / khoảng trắng / chữ / dấu trừ gõ vào đều bị bỏ qua.
 *   • Dán "1.000.000", "235,335", "235 335" đều được; dán chữ, số âm, số thập phân thì không nhận.
 *   • Tự thêm dấu chấm khi gõ, con trỏ giữ đúng chỗ.
 *   • Chưa có giá trị: nền xám, chữ mờ "Nhập liệu"; bấm vào: nền trắng, viền nổi bật.
 */
export function NumberInput({
  id,
  value,
  onValueChange,
  onBlur,
  maxDigits,
  invalid = false,
  suffix,
  label,
  describedBy,
  placeholder = "Nhập liệu",
}: {
  id: string;
  value: string;
  onValueChange: (digits: string) => void;
  onBlur?: () => void;
  maxDigits: number;
  invalid?: boolean;
  /** Đơn vị hiện ở cuối ô, vd "đ". */
  suffix?: string;
  /** Tên ô cho trình đọc màn hình (khi không có nhãn đi kèm). */
  label?: string;
  describedBy?: string;
  /** Chữ mờ khi ô còn trống (mặc định "Nhập liệu" như ở màn Nhập liệu ads). */
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [pasteRejected, setPasteRejected] = useState(false);

  // Đặt lại con trỏ ngay sau khi ô hiện số mới (tránh con trỏ nhảy về cuối khi dấu chấm tự thêm / bớt).
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaret.current !== null && document.activeElement === el) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  function apply(el: HTMLInputElement, raw: string, caret: number) {
    const next = normalizeInput(raw, caret, maxDigits);
    // Vượt số chữ số tối đa → giữ nguyên, con trỏ đứng như trước khi gõ.
    const position = next ? next.caret : Math.max(0, caret - (raw.length - groupThousands(value).length));
    setPasteRejected(false);
    if (next && next.digits !== value) {
      pendingCaret.current = position; // đặt sau khi ô hiện số mới (useLayoutEffect ở trên)
      onValueChange(next.digits);
      return;
    }
    // Gõ ký tự không hợp lệ (hoặc quá dài): số không đổi → tự trả ô về số cũ ngay, giữ con trỏ tại chỗ.
    el.value = groupThousands(value);
    el.setSelectionRange(position, position);
  }

  return (
    <div className="grid gap-1">
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="text"
          inputMode="numeric"
          enterKeyHint="next"
          data-number-input=""
          autoComplete="off"
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={groupThousands(value)}
          onChange={(event) => {
            const el = event.currentTarget;
            apply(el, el.value, el.selectionStart ?? el.value.length);
          }}
          onKeyDown={(event) => {
            const el = event.currentTarget;
            // Nút "Tiếp" / Enter trên bàn phím điện thoại → sang ô số kế tiếp; ô cuối thì đóng bàn phím.
            if (event.key === "Enter") {
              event.preventDefault();
              const scope = el.closest("[role=dialog]") ?? document;
              const inputs = [...scope.querySelectorAll<HTMLInputElement>("input[data-number-input]")].filter(
                (input) => !input.disabled && input.offsetParent !== null,
              );
              const next = inputs[inputs.indexOf(el) + 1];
              if (next) next.focus();
              else el.blur();
              return;
            }
            // Xoá lùi ngay sau dấu chấm → xoá luôn chữ số đứng trước dấu chấm.
            const at = el.selectionStart;
            if (at === null || at !== el.selectionEnd) return;
            if (event.key === "Backspace" && at > 0 && el.value[at - 1] === ".") el.setSelectionRange(at - 1, at - 1);
            if (event.key === "Delete" && el.value[at] === ".") el.setSelectionRange(at + 1, at + 1);
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (!isNumberText(text)) {
              setPasteRejected(true);
              return;
            }
            const el = event.currentTarget;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? start;
            const pasted = text.replace(/\D/g, "");
            apply(el, el.value.slice(0, start) + pasted + el.value.slice(end), start + pasted.length);
          }}
          onBlur={() => {
            setPasteRejected(false);
            onBlur?.();
          }}
          className={cn(
            "h-9 w-full min-w-0 rounded-lg border px-2.5 text-right text-base tabular-nums transition-colors outline-none md:text-sm",
            "placeholder:text-muted-foreground/80 focus:placeholder:text-transparent",
            value === "" ? "border-transparent bg-muted" : "border-input bg-background",
            "focus:border-primary focus:bg-background focus:ring-3 focus:ring-primary/25",
            invalid && "border-destructive bg-background focus:border-destructive focus:ring-destructive/20",
            suffix && "pr-6",
          )}
        />
        {suffix && value !== "" && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {pasteRejected && (
        <p className="text-xs text-destructive" role="alert">
          Chỉ dán được số nguyên ≥ 0
        </p>
      )}
    </div>
  );
}
