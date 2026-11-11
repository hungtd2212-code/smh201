import Image from "next/image";
import logoImg from "@/assets/brand/smile-hub-logo.png";
import markImg from "@/assets/brand/smile-hub-mark.png";
import wordmarkImg from "@/assets/brand/smile-hub-wordmark.png";
import { APP } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Logo Smile Hub (ảnh gốc của phòng khám, nền trong suốt).
 * Muốn đổi logo: thay 3 file PNG trong src/assets/brand/ và src/app/icon.png.
 */

/** Dạng ngang cho menu trái: biểu tượng răng + chữ "Smile Hub" + dòng mô tả. */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image src={markImg} alt="" loading="eager" className="h-9 w-auto shrink-0" />
      <span className="grid gap-1">
        <Image
          src={wordmarkImg}
          alt={APP.name}
          loading="eager"
          className="h-4.5 w-auto"
        />
        <span className="text-xs leading-none text-muted-foreground">
          {APP.tagline}
        </span>
      </span>
    </span>
  );
}

/** Logo đầy đủ (biểu tượng trên, chữ dưới) cho trang đăng nhập. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <Image
      src={logoImg}
      alt={APP.name}
      loading="eager"
      className={cn("h-24 w-auto", className)}
    />
  );
}
