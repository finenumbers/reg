"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ColumnFilters } from "@/components/column-filters/types";
import { EXPORT_XLSX_BUTTON_CLASS } from "@/components/export-xlsx-button-class";
import { Button } from "@/components/ui/button";
import type { TimeSort } from "@/modules/traffic/traffic-sort";

type Props = {
  month: string;
  snapshot: string | null;
  filters: ColumnFilters;
  phoneQ: string;
  phantom: boolean;
  callErrors: boolean;
  parking: boolean;
  failed: boolean;
  check: boolean;
  success: boolean;
  timeSort: TimeSort | null;
};

export function OprsExportButton(props: Props) {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    if (busyRef.current || !props.snapshot) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/oprs/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: props.month,
          snapshot: props.snapshot,
          filters: props.filters,
          phoneQ: props.phoneQ,
          phantom: props.phantom,
          callErrors: props.callErrors,
          parking: props.parking,
          failed: props.failed,
          check: props.check,
          success: props.success,
          timeSort: props.timeSort,
        }),
      });
      const started = (await res.json()) as {
        error?: string;
        job?: { id: string; status: string; error: string | null };
      };
      if (!res.ok || !started.job) {
        toast.error(started.error?.trim() || "Не удалось начать выгрузку");
        return;
      }
      const id = started.job.id;
      for (;;) {
        const statusRes = await fetch(`/api/oprs/export/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const body = (await statusRes.json()) as {
          error?: string;
          job?: { status: string; error: string | null };
        };
        if (!statusRes.ok || !body.job) {
          toast.error(body.error?.trim() || "Не удалось скачать файл");
          return;
        }
        if (body.job.status === "error") {
          toast.error(body.job.error?.trim() || "Не удалось сформировать XLSX");
          return;
        }
        if (body.job.status === "ready") break;
        await new Promise((resolve) => {
          window.setTimeout(resolve, 700);
        });
      }
      const link = document.createElement("a");
      link.href = `/api/oprs/export/${encodeURIComponent(id)}/download`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Не удалось скачать файл");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      className={EXPORT_XLSX_BUTTON_CLASS}
      disabled={busy || !props.snapshot}
      onClick={() => void onExport()}
    >
      {busy ? "Экспорт…" : "Экспорт XLSX"}
    </Button>
  );
}
