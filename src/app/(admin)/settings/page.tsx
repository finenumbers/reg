import { requirePagePermission } from "@/modules/auth/guards";
import { getParkingKeyStatus } from "@/modules/antifraud/secret";
import { getSettingsView } from "@/modules/settings";
import { StorageView } from "@/modules/storage/ui/storage-view";
import { SettingsForm } from "./settings-form";
import { ApiKeysPanel } from "./api-keys-panel";
import { ParkingKeyPanel } from "./parking-key-panel";

export default async function SettingsPage() {
  await requirePagePermission("settings:write");
  const [settings, parkingKey] = await Promise.all([
    getSettingsView(),
    getParkingKeyStatus(),
  ]);

  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Настройки
        </h1>
        <p className="text-muted-foreground text-sm">
          SSH-профиль, импорт зашифрованного ключа, параметры опроса и месяцы CDR. Ключи
          маскируются при хранении и в UI — только замена.
        </p>
      </div>
      <SettingsForm initial={settings} />
      <ParkingKeyPanel initial={parkingKey} />
      <ApiKeysPanel />
      <StorageView />
    </div>
  );
}
