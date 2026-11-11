"use client";

import { Pencil, Plus, Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCatalogs } from "@/components/catalog-provider";
import { FormDialog, toNumber, toText, type FieldDef, type FormValues } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saveCatalogRow } from "@/lib/catalog/repo";
import type { Service } from "@/lib/catalog/types";
import { ActivePill, CatalogGate, DeleteRowButton, PageHeader, formatVnd, useCanManage } from "./shared";

const FIELDS: FieldDef[] = [
  { name: "name", label: "Tên dịch vụ", type: "text", required: true, wide: true },
  { name: "price", label: "Giá niêm yết (₫)", type: "number", placeholder: "Để trống nếu chưa có" },
  { name: "sort_order", label: "Thứ tự hiển thị", type: "number" },
  { name: "is_active", label: "Trạng thái", type: "checkbox", text: "Đang dùng (hiện trong các form)", wide: true },
];

/** Cài đặt → Dịch vụ & Bảng giá. Danh sách này là nguồn cho ô "Dịch vụ quan tâm" của lead và chiến dịch. */
export function ServicesManager() {
  const { catalogs, reload } = useCatalogs();
  const canManage = useCanManage();
  const [editing, setEditing] = useState<{ open: boolean; row: Service | null }>({ open: false, row: null });

  async function save(values: FormValues) {
    await saveCatalogRow("services", editing.row?.id ?? null, {
      name: toText(values.name),
      price: toNumber(values.price),
      sort_order: toNumber(values.sort_order) ?? 0,
      is_active: Boolean(values.is_active),
    });
    await reload();
    toast.success(editing.row ? "Đã cập nhật dịch vụ" : "Đã thêm dịch vụ");
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        icon={Tags}
        title="Dịch vụ & Bảng giá"
        description="Danh sách dịch vụ của phòng khám, dùng cho lead, chiến dịch và báo giá."
      >
        {canManage && (
          <Button onClick={() => setEditing({ open: true, row: null })}>
            <Plus />
            Thêm dịch vụ
          </Button>
        )}
      </PageHeader>

      <CatalogGate>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Dịch vụ</TableHead>
                <TableHead className="text-right">Giá niêm yết</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalogs.services.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    Chưa có dịch vụ nào
                  </TableCell>
                </TableRow>
              ) : (
                catalogs.services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium">{service.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatVnd(service.price)}</TableCell>
                    <TableCell>
                      <ActivePill active={service.is_active} />
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Sửa dịch vụ ${service.name}`}
                            onClick={() => setEditing({ open: true, row: service })}
                          >
                            <Pencil />
                          </Button>
                          <DeleteRowButton table="services" id={service.id} what={`dịch vụ ${service.name}`} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CatalogGate>

      <FormDialog
        open={editing.open}
        onOpenChange={(open) => setEditing((prev) => ({ ...prev, open }))}
        title={editing.row ? "Sửa dịch vụ" : "Thêm dịch vụ"}
        fields={FIELDS}
        initialValues={{
          name: editing.row?.name ?? "",
          price: editing.row?.price?.toString() ?? "",
          sort_order: (editing.row?.sort_order ?? catalogs.services.length + 1).toString(),
          is_active: editing.row?.is_active ?? true,
        }}
        onSubmit={save}
      />
    </div>
  );
}
