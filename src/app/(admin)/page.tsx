/**
 * Home is the Dashboard. There is no nav item; the logo links here.
 */
import { DashboardView } from "@/modules/dashboard/ui/dashboard-view";

export default function HomePage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="shrink-0 text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
        Dashboard
      </h1>
      <DashboardView />
    </div>
  );
}
