import { AppShell } from "@/components/app-shell";
import { requirePageSession } from "@/modules/auth/guards";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requirePageSession();

  return (
    <AppShell
      username={ctx.username ?? ctx.session.user.name}
      permissions={ctx.authz.permissions}
    >
      {children}
    </AppShell>
  );
}
