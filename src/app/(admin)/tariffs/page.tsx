import { requirePagePermission } from "@/modules/auth/guards";
import { listTariffRates } from "@/modules/tariffs/service";
import { TariffsView } from "@/modules/tariffs/ui/tariffs-view";

export default async function TariffsPage() {
  await requirePagePermission("phones:read");
  const initial = await listTariffRates({ page: 1, pageSize: 100 });
  return <TariffsView initial={initial} />;
}
