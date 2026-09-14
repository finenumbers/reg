import { requirePagePermission } from "@/modules/auth/guards";
import { getSettingsView } from "@/modules/settings";
import { StorageView } from "@/modules/storage/ui/storage-view";
import { SettingsForm } from "./settings-form";
import { ApiKeysPanel } from "./api-keys-panel";

export default async function SettingsPage() {
  await requirePagePermission("settings:write");
  const settings = await getSettingsView();

  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>
        <p className="text-sm text-muted-foreground">
          SSH-профиль, импорт зашифрованного ключа, параметры опроса и месяцы
          CDR. Ключи маскируются при хранении и в UI — только замена.
        </p>
      </div>
      <SettingsForm initial={settings} />
      <ApiKeysPanel />
      <StorageView />
    </div>
  );
}
