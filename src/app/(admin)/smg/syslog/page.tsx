import { requirePagePermission } from "@/modules/auth/guards";
import { withBridgeDevices } from "@/modules/smg-syslog/browse";
import { syslogNodeLabels } from "@/modules/smg-syslog/identifier";
import { listSyslogNodes } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { SyslogView } from "@/modules/smg-syslog/ui/syslog-view";

export default async function SmgSyslogPage() {
  await requirePagePermission("phones:read");
  const devices = withBridgeDevices(
    syslogNodeLabels(await listSyslogNodes()),
    syslogRoot(),
  );
  return <SyslogView initialDevices={devices} />;
}
