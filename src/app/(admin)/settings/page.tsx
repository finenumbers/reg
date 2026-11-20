import { requirePagePermission } from "@/modules/auth/guards";
import { getParkingKeyStatus } from "@/modules/antifraud/secret";
import { getMailView } from "@/modules/mail/store";
import { getSettingsView } from "@/modules/settings";
import { StorageView } from "@/modules/storage/ui/storage-view";
import { ApiKeysPanel } from "./api-keys-panel";
import { MailPanel } from "./mail-panel";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  await requirePagePermission("settings:write");
  const [settings, parkingKey, mail] = await Promise.all([
    getSettingsView(),
    getParkingKeyStatus(),
    getMailView(),
  ]);

  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Настройки
        </h1>
        <p className="text-muted-foreground text-sm">
          SSH-профиль софтсвитча, учётная запись API РТУ только для чтения, ключ чтения
          Parking, исходящая почта, параметры опроса и месяцы CDR. Ключи маскируются при
          хранении и в UI — только замена. Почта только отправляет письма.
        </p>
      </div>
      <SettingsForm initial={settings} parkingKey={parkingKey} />
      <MailPanel initial={mail} />
      <ApiKeysPanel />
      <StorageView />
    </div>
  );
}
