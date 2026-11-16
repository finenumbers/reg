import { requirePagePermission } from "@/modules/auth/guards";
import { getNumberingSyncView } from "@/modules/numbering-sync/service";
import { NumberingSyncForm } from "@/modules/numbering-sync/ui/numbering-sync-form";
import { getRunexisSyncView } from "@/modules/runexis/service";
import { RunexisSyncForm } from "@/modules/runexis/ui/runexis-sync-form";
import { getUisSyncView } from "@/modules/uis/service";
import { UisSyncForm } from "@/modules/uis/ui/uis-sync-form";
import { getAuroraSyncView } from "@/modules/aurora/service";
import { AuroraSyncForm } from "@/modules/aurora/ui/aurora-sync-form";
import { getExolveSyncView } from "@/modules/exolve/service";
import { ExolveSyncForm } from "@/modules/exolve/ui/exolve-sync-form";

export const dynamic = "force-dynamic";

export default async function NumberingSyncPage() {
  await requirePagePermission("settings:write");
  const [initial, runexis, uis, aurora, exolve] = await Promise.all([
    getNumberingSyncView(),
    getRunexisSyncView(),
    getUisSyncView(),
    getAuroraSyncView(),
    getExolveSyncView(),
  ]);
  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Синхронизация
        </h1>
        <p className="text-muted-foreground text-sm">
          Каждый источник читает свои номера отдельно и заменяет только свои строки.
        </p>
      </div>
      <NumberingSyncForm initial={initial} />
      <RunexisSyncForm initial={runexis} />
      <UisSyncForm initial={uis} />
      <AuroraSyncForm initial={aurora} />
      <ExolveSyncForm initial={exolve} />
    </div>
  );
}
