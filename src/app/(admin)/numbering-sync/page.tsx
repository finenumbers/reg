import { requirePagePermission } from "@/modules/auth/guards";
import { getNumberingSyncView } from "@/modules/numbering-sync/service";
import { NumberingSyncForm } from "@/modules/numbering-sync/ui/numbering-sync-form";
import { getRunexisSyncView } from "@/modules/runexis/service";
import { RunexisSyncForm } from "@/modules/runexis/ui/runexis-sync-form";

export const dynamic = "force-dynamic";

export default async function NumberingSyncPage() {
  await requirePagePermission("settings:write");
  const [initial, runexis] = await Promise.all([
    getNumberingSyncView(),
    getRunexisSyncView(),
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
    </div>
  );
}
