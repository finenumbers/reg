import { requirePagePermission } from "@/modules/auth/guards";
import { ChainBar } from "@/modules/numbering-chain/ui/chain-bar";
import { readSyncScreen } from "@/modules/numbering-chain/screen";
import { ChainProvider } from "@/modules/numbering-chain/ui/chain-context";
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
import { getVoximplantSyncView } from "@/modules/voximplant/service";
import { VoximplantSyncForm } from "@/modules/voximplant/ui/voximplant-sync-form";
import { getFinenumbersSyncView } from "@/modules/finenumbers/service";
import { FinenumbersSyncForm } from "@/modules/finenumbers/ui/finenumbers-sync-form";
import { getMcnSyncView } from "@/modules/mcn/service";
import { McnSyncForm } from "@/modules/mcn/ui/mcn-sync-form";

export const dynamic = "force-dynamic";

export default async function NumberingSyncPage() {
  await requirePagePermission("settings:write");
  const [initial, runexis, uis, aurora, exolve, voximplant, mcn, finenumbers, screen] =
    await Promise.all([
      getNumberingSyncView(),
      getRunexisSyncView(),
      getUisSyncView(),
      getAuroraSyncView(),
      getExolveSyncView(),
      getVoximplantSyncView(),
      getMcnSyncView(),
      getFinenumbersSyncView(),
      readSyncScreen(),
    ]);
  return (
    <ChainProvider initial={screen}>
      <div className="h-full space-y-6 overflow-y-auto">
        <div>
          <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
            Синхронизация
          </h1>
          <p className="text-muted-foreground text-sm">
            Кнопка заменяет только свою сторону источника: старый список этой стороны удаляется и записывается заново.
          </p>
        </div>
        <ChainBar />
        <hr className="border-border" />
        <NumberingSyncForm initial={initial} />
        <hr className="border-border" />
        <RunexisSyncForm initial={runexis} />
        <hr className="border-border" />
        <UisSyncForm initial={uis} />
        <hr className="border-border" />
        <AuroraSyncForm initial={aurora} />
        <hr className="border-border" />
        <ExolveSyncForm initial={exolve} />
        <hr className="border-border" />
        <VoximplantSyncForm initial={voximplant} />
        <hr className="border-border" />
        <McnSyncForm initial={mcn} />
        <hr className="border-border" />
        <FinenumbersSyncForm initial={finenumbers} />
      </div>
    </ChainProvider>
  );
}
