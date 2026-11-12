"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AdAccount } from "@/lib/catalog/types";

/**
 * Các TKQC đang TẠM ẨN ở bảng nhập của một người (không chạy trong thời gian này). Lưu trên máy đang dùng
 * (trình duyệt) để lần sau mở lại vẫn đúng; không lưu được thì vẫn dùng được trong lần mở trang này.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const keyOf = (personId: string) => `smh.nhap-lieu.tkqc-an.${personId}`;

function read(key: string) {
  if (memory.has(key)) return memory.get(key) ?? "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

export function useHiddenAccounts(personId: string | undefined) {
  const key = personId ? keyOf(personId) : "";
  const raw = useSyncExternalStore(subscribe, () => (key ? read(key) : ""), () => "");
  const hidden = useMemo(() => new Set(raw ? raw.split(",") : []), [raw]);
  const setHidden = (next: Set<string>) => {
    if (!key) return;
    const value = [...next].join(",");
    memory.set(key, value);
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // trình duyệt chặn lưu → chỉ nhớ trong lần mở trang này
    }
    listeners.forEach((notify) => notify());
  };
  return [hidden, setHidden] as const;
}

/** Ô "Tài khoản quảng cáo": tick chọn một, vài hoặc tất cả TKQC để hiện ở bảng nhập. */
export function AccountPicker({
  accounts,
  hidden,
  onChange,
}: {
  accounts: AdAccount[];
  hidden: Set<string>;
  onChange: (hidden: Set<string>) => void;
}) {
  const shown = accounts.filter((a) => !hidden.has(a.id)).length;
  const all = shown === accounts.length;
  const label = all ? `Tất cả TKQC (${accounts.length})` : `${shown}/${accounts.length} TKQC đang chọn`;

  const toggle = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-60 justify-between font-normal" aria-label="Tài khoản quảng cáo">
          <span className="truncate">{label}</span>
          <ChevronDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium hover:bg-muted">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = !all && shown > 0;
            }}
            onChange={() => onChange(all ? new Set(accounts.map((a) => a.id)) : new Set())}
          />
          Tất cả TKQC ({accounts.length})
        </label>
        <div className="my-1 border-t" />
        <div className="max-h-72 overflow-y-auto">
          {accounts.map((account) => (
            <label
              key={account.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={!hidden.has(account.id)}
                onChange={() => toggle(account.id)}
              />
              <span className="truncate">{account.name}</span>
            </label>
          ))}
        </div>
        <p className="border-t px-2.5 pt-2 pb-1.5 text-xs text-muted-foreground">
          Tick các TKQC đang chạy để nhập. Lựa chọn được nhớ cho lần sau.
        </p>
      </PopoverContent>
    </Popover>
  );
}
