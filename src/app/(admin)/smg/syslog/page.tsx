import { requirePagePermission } from "@/modules/auth/guards";
import { listSyslogNodes } from "@/modules/smg-syslog/nodes";
import { SyslogView } from "@/modules/smg-syslog/ui/syslog-view";

export default async function SmgSyslogPage() {
  await requirePagePermission("phones:read");
  const devices = await listSyslogNodes();
  return <SyslogView initialDevices={devices} />;
}
