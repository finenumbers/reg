import { requirePagePermission } from "@/modules/auth/guards";
import { listJobRuns } from "@/modules/jobs/query";
import { JobsView } from "@/modules/jobs/ui/jobs-view";

export default async function JobsPage() {
  await requirePagePermission("regs:read");
  const initial = await listJobRuns({ page: 1, pageSize: 100 });

  return <JobsView initial={initial} />;
}
