import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { getCurrentEnrichJob } from "@/modules/enrich/jobs";
import { EnrichView } from "@/modules/enrich/ui/enrich-view";
import { getEnrichReadyFlags } from "@/modules/pstn/credentials";

export default async function EnrichPage() {
  const ctx = await requirePagePermission("phones:read");
  const canOpenSettings = hasPermission(ctx.authz.permissions, "settings:write");
  const flags = await getEnrichReadyFlags();
  const initialJob = await getCurrentEnrichJob(ctx.session.user.id);
  return (
    <EnrichView
      canOpenSettings={canOpenSettings}
      initialReady={{
        hasPstnApiKey: flags.hasPstnApiKey,
        hasGeoipApiKey: flags.hasGeoipApiKey,
        ready: flags.hasPstnApiKey && flags.hasGeoipApiKey,
      }}
      initialJob={initialJob}
    />
  );
}
