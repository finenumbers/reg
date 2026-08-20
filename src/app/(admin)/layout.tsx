import { AppShell } from "@/components/app-shell";
import { DisplayTimezoneProvider } from "@/components/display-timezone-provider";
import { requirePageSession } from "@/modules/auth/guards";
import { getDisplayTimezone } from "@/modules/settings";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requirePageSession();
  const displayTimezone = await getDisplayTimezone();

  return (
    <DisplayTimezoneProvider initial={displayTimezone}>
      <AppShell
        username={ctx.username ?? ctx.session.user.name}
        permissions={ctx.authz.permissions}
      >
        {children}
      </AppShell>
    </DisplayTimezoneProvider>
  );
}
