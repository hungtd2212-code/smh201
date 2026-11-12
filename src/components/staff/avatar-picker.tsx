"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { StaffAvatar } from "./staff-avatar";

/**
 * Ô chọn ảnh đại diện trong form: xem trước ảnh mới chọn; chưa lưu thì chưa tải lên.
 * `value`: File mới chọn | "remove" (bỏ ảnh) | null (giữ nguyên ảnh cũ `current`).
 */
export type AvatarChoice = File | "remove" | null;

export function AvatarPicker({
  name,
  current,
  value,
  onChange,
}: {
  name: string;
  current?: string | null;
  value: AvatarChoice;
  onChange: (value: AvatarChoice) => void;
}) {
  const id = useId();
  const preview = useMemo(() => (value instanceof File ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  const shown = value === "remove" ? null : (preview ?? current ?? null);

  return (
    <div className="flex items-center gap-3">
      <StaffAvatar name={name || "?"} url={shown} className="size-16 text-base" />
      <div className="grid gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <label htmlFor={id} className="cursor-pointer">
              <ImagePlus />
              {shown ? "Đổi ảnh" : "Chọn ảnh"}
            </label>
          </Button>
          {shown && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(current ? "remove" : null)}>
              <Trash2 />
              Bỏ ảnh
            </Button>
          )}
        </div>
        <input
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChange(file);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-muted-foreground">JPG / PNG, tự cắt vuông và thu nhỏ khi lưu.</p>
      </div>
    </div>
  );
}
