import { requirePagePermission } from "@/modules/auth/guards";
import { withBridgeDevices } from "@/modules/smg-syslog/browse";
import { listSyslogNodes } from "@/modules/smg-syslog/nodes";
import { syslogRoot } from "@/modules/smg-syslog/paths";
import { SyslogView } from "@/modules/smg-syslog/ui/syslog-view";

export default async function SmgSyslogPage() {
  await requirePagePermission("phones:read");
  const devices = withBridgeDevices(await listSyslogNodes(), syslogRoot());
  return <SyslogView initialDevices={devices} />;
}
