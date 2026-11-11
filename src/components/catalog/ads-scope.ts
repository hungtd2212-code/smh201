"use client";

import { useMemo } from "react";
import { useCatalogs } from "@/components/catalog-provider";
import { managesMarketingRole, useCurrentStaff } from "@/hooks/use-current-staff";
import type { AdAccountAssignment } from "@/lib/catalog/types";
import { useTodayVn } from "./shared";

/** Phân công này có hiệu lực vào ngày `day` (yyyy-MM-dd) không. */
export const coversDay = (assignment: AdAccountAssignment, day: string) =>
  assignment.from_date <= day && (!assignment.to_date || assignment.to_date >= day);

/**
 * Người đang đăng nhập được làm gì trong danh mục Marketing. Chỉ để ẩn / hiện nút cho đúng —
 * quyền thật do Supabase kiểm soát (supabase/005_marketing_catalog.sql).
 *   • Quản trị, Trưởng Marketing: thêm / sửa mọi thứ.
 *   • Nhân viên Ads: thêm / sửa chiến dịch và bài post trong các TKQC ĐANG được giao.
 *   • Vai trò khác: chỉ xem.
 */
export function useAdsScope() {
  const staff = useCurrentStaff();
  const { catalogs } = useCatalogs();
  const today = useTodayVn();

  return useMemo(() => {
    const role = staff.status === "ok" ? staff.role : null;
    const managesMarketing = role !== null && managesMarketingRole(role);
    const isAdsStaff = role === "ads_staff";

    // Nhân viên Ads chỉ đọc được dòng ads_staff và các phân công của chính mình.
    const me = isAdsStaff && staff.status === "ok"
      ? catalogs.adsStaff.find((a) => a.user_id === staff.userId)
      : undefined;
    const myCurrentAccounts = new Set(
      me?.is_active
        ? catalogs.assignments
            .filter((x) => x.ads_staff_id === me.id && coversDay(x, today))
            .map((x) => x.ad_account_id)
        : [],
    );

    const canEditAccount = (adAccountId: string | null) =>
      managesMarketing || (adAccountId !== null && myCurrentAccounts.has(adAccountId));
    const campaignAccount = new Map(catalogs.campaigns.map((c) => [c.id, c.ad_account_id]));

    return {
      managesMarketing,
      isAdsStaff,
      /** Được thêm / sửa chiến dịch thuộc TKQC này. */
      canEditAccount,
      /** Được thêm / sửa bài post thuộc chiến dịch này. */
      canEditCampaign: (campaignId: string | null) =>
        managesMarketing ||
        (campaignId !== null && canEditAccount(campaignAccount.get(campaignId) ?? null)),
      /** Có ít nhất một TKQC để thêm chiến dịch vào. */
      canAddCampaign: managesMarketing || myCurrentAccounts.size > 0,
    };
  }, [staff, catalogs, today]);
}
