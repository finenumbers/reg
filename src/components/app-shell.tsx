"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FEATURE_MODULES } from "@/lib/modules";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/auth/auth-client";
import { cn } from "@/lib/utils";

function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

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
  const pathname = usePathname() ?? "";
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
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Equal 20px inset around the longest label «Телефонные номера» (141.25px). */}
      <aside className="sticky top-0 flex h-screen w-[calc(2.5rem+141.25px+1px)] shrink-0 flex-col overflow-hidden border-r border-border bg-card px-3 py-4">
        <Link href="/" className="flex shrink-0 justify-center pb-4">
          <img
            src="/brand/logo-full.png"
            alt="fine numbers"
            className="h-auto w-[140px] bg-transparent object-contain"
          />
        </Link>
        <Separator className="mb-3 shrink-0" />
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
          {nav.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-bold transition-colors",
                  active
                    ? "bg-black text-white hover:bg-black hover:text-white"
                    : "text-black hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto shrink-0 space-y-2 px-2 pt-4">
          <p className="text-xs text-muted-foreground">
            {username ? `Вы вошли как ${username}` : "Не авторизован"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onLogout}
          >
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
