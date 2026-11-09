import { requirePagePermission } from "@/modules/auth/guards";
import { getVatsSettings, loadVatsCatalogs } from "@/modules/vats/service";
import { VatsSettingsForm } from "@/modules/vats/ui/settings-form";

export const dynamic = "force-dynamic";

export default async function VatsSettingsPage() {
  await requirePagePermission("vats:write");
  const [settings, catalogs] = await Promise.all([getVatsSettings(), loadVatsCatalogs()]);
  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          Настройки ВАТС
        </h1>
        <p className="text-muted-foreground text-sm">
          Хост и ключ платформы хранятся здесь. Пароль в интерфейсе не показывается.
        </p>
      </div>
      <VatsSettingsForm initial={settings} catalogs={catalogs} />
    </div>
  );
}
