import { requirePagePermission } from "@/modules/auth/guards";
import { getNumberingLoadView } from "@/modules/numbering-load/service";
import { NumberingLoadForm } from "@/modules/numbering-load/ui/numbering-load-form";

export const dynamic = "force-dynamic";

export default async function NumberingLoadPage() {
  await requirePagePermission("settings:write");
  const initial = await getNumberingLoadView();
  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Загрузка нумерации
        </h1>
        <p className="text-muted-foreground text-sm">
          Адрес и токен источника. Токен хранится в зашифрованном виде и на экране не
          показывается. Сохранение не проверяет доступ.
        </p>
      </div>
      <NumberingLoadForm initial={initial} />
    </div>
  );
}
