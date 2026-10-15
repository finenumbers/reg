import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { withBridgeDevices } from "@/modules/smg-syslog/browse";
import { syslogNodeLabels } from "@/modules/smg-syslog/identifier";
import { listSyslogNodes } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { SyslogView } from "@/modules/smg-syslog/ui/syslog-view";

export default async function SmgSyslogPage() {
  const ctx = await requirePagePermission("phones:read");
  const canPurge = hasPermission(ctx.authz.permissions, "settings:write");
  const devices = withBridgeDevices(
    syslogNodeLabels(await listSyslogNodes()),
    syslogRoot(),
  );
  return <SyslogView initialDevices={devices} canPurge={canPurge} />;
}
