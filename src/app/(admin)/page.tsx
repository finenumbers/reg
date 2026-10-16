/**
 * Home is the Dashboard. There is no nav item; the logo links here.
 */
import { DashboardView } from "@/modules/dashboard/ui/dashboard-view";

export default function HomePage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <DashboardView />
    </div>
  );
}
