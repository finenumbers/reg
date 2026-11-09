import { requirePagePermission } from "@/modules/auth/guards";
import {
  getVatsCatalogView,
  getVatsSettings,
  getVatsStatus,
} from "@/modules/vats/service";
import { VatsSettingsForm } from "@/modules/vats/ui/settings-form";
import { VatsLoadStatus } from "@/modules/vats/ui/section-table";

export const dynamic = "force-dynamic";

export default async function VatsSettingsPage() {
  await requirePagePermission("vats:write");
  const [settings, catalogs, status] = await Promise.all([
    getVatsSettings(),
    getVatsCatalogView(),
    getVatsStatus(),
  ]);
  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Настройки ВАТС
        </h1>
        <VatsLoadStatus
          section="settings"
          readAt={status.settings.readAt}
          notice={status.settings.notice}
        />
      </div>
      <VatsSettingsForm initial={settings} catalogs={catalogs} />
    </div>
  );
}
