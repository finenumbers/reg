"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FEATURE_MODULES } from "@/lib/modules";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/auth/auth-client";
export function AppShell({
  children,
  username,
  permissions = [],
}: {
  children: React.ReactNode;
  username?: string | null;
  permissions?: readonly string[];
}) {
  const router = useRouter();
  const granted = new Set(permissions);

  const nav = FEATURE_MODULES.filter((m) => m.href)
    .filter((m) => !m.navPermission || granted.has(m.navPermission))
    .map((m) => ({
      href: m.href!,
      label: m.title,
    }));

  async function onLogout() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card px-3 py-4">
        <div className="px-2 pb-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Softswitch Ops
          </p>
          <p className="text-lg font-semibold tracking-tight">Reg Platform</p>
        </div>
        <Separator className="mb-3" />
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-2 pt-4">
          <p className="text-xs text-muted-foreground">
            {username ? `Вы вошли как ${username}` : "Не авторизован"}
          </p>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={onLogout}>
            Выйти
          </Button>
        </div>
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6">
        {children}
      </main>
    </div>
  );
}
