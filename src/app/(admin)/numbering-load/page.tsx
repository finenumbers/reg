import { requirePagePermission } from "@/modules/auth/guards";
import { getNumberingLoadView } from "@/modules/numbering-load/service";
import { NumberingLoadForm } from "@/modules/numbering-load/ui/numbering-load-form";
import { getRunexisAccessView } from "@/modules/runexis/service";
import { RunexisLoadForm } from "@/modules/runexis/ui/runexis-load-form";

export const dynamic = "force-dynamic";

export default async function NumberingLoadPage() {
  await requirePagePermission("settings:write");
  const [initial, runexis] = await Promise.all([
    getNumberingLoadView(),
    getRunexisAccessView(),
  ]);
  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Загрузка нумерации
        </h1>
        <p className="text-muted-foreground text-sm">
          Доступ к API источников нумерации. Секрет хранится в зашифрованном виде и на
          экране не показывается. Сохранение не вызывает площадку.
        </p>
      </div>
      <NumberingLoadForm initial={initial} />
      <RunexisLoadForm initial={runexis} />
    </div>
  );
}
