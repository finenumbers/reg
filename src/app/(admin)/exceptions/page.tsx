import { listDialExceptions } from "@/modules/exceptions/service";
import { ExceptionsView } from "@/modules/exceptions/ui/exceptions-view";
import { requirePagePermission } from "@/modules/auth/guards";

export default async function ExceptionsPage() {
  await requirePagePermission("phones:read");
  const initial = await listDialExceptions();
  return <ExceptionsView initial={initial} />;
}
