import { redirect } from "next/navigation";

/** Địa chỉ cũ: trang Nhân viên Ads nay là một thẻ của Marketing → Cài đặt. */
export default function OldAddress() {
  redirect("/marketing/cai-dat?tab=nhan-vien-ads");
}
