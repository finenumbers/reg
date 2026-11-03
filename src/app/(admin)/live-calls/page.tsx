import { requirePagePermission } from "@/modules/auth/guards";
import { LiveCallsView } from "@/modules/live-calls/ui/live-calls-view";

export const dynamic = "force-dynamic";

export default async function LiveCallsPage() {
  await requirePagePermission("phones:read");
  return <LiveCallsView />;
}
