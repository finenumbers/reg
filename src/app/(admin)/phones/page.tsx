import { requirePagePermission } from "@/modules/auth/guards";
import { listPhones } from "@/modules/phones/service";
import { PhonesView } from "@/modules/phones/ui/phones-view";
import { countUnregisteredCurrent } from "@/modules/registrations/status";

export default async function PhonesPage() {
  await requirePagePermission("phones:read");
  const [initial, initialRegsUnregisteredCount] = await Promise.all([
    listPhones({
      kind: "endpoints_registered",
      page: 1,
      pageSize: 100,
    }),
    countUnregisteredCurrent(),
  ]);

  return (
    <PhonesView
      initial={initial}
      initialRegsUnregisteredCount={initialRegsUnregisteredCount}
    />
  );
}
