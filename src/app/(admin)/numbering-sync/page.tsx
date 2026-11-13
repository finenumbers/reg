import { requirePagePermission } from "@/modules/auth/guards";
import { getNumberingSyncView } from "@/modules/numbering-sync/service";
import { NumberingSyncForm } from "@/modules/numbering-sync/ui/numbering-sync-form";

export const dynamic = "force-dynamic";

export default async function NumberingSyncPage() {
  await requirePagePermission("settings:write");
  const initial = await getNumberingSyncView();
  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Синхронизация
        </h1>
        <p className="text-muted-foreground text-sm">
          Ключ SipOut хранится в зашифрованном виде и на экране не показывается. Загрузка
          заменяет только номера этого источника.
        </p>
      </div>
      <NumberingSyncForm initial={initial} />
    </div>
  );
}
