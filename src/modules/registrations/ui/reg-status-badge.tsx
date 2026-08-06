"use client";

import { Badge } from "@/components/ui/badge";
import {
  formatRegStatus,
  statusBadgeVariant,
} from "@/modules/registrations/ui-format";
import type { RegistrationListItem } from "@/modules/registrations/types";
import { cn } from "@/lib/utils";

export function RegStatusBadge({
  status,
  className,
}: {
  status: RegistrationListItem["status"];
  className?: string;
}) {
  return (
    <Badge
      variant={statusBadgeVariant(status)}
      className={cn(
        status === "Registered"
          ? "bg-emerald-600 text-white hover:bg-emerald-600/90"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {formatRegStatus(status)}
    </Badge>
  );
}
