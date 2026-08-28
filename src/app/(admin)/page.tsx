import { redirect } from "next/navigation";
import { requirePageSession } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";

/**
 * Home → Регистрации. Falls back to the first module the user can open.
 */
export default async function HomePage() {
  const ctx = await requirePageSession();
  const perms = ctx.authz.permissions;

  if (hasPermission(perms, "regs:read")) {
    redirect("/regs");
  }
  if (hasPermission(perms, "phones:read")) {
    redirect("/phones");
  }
  if (hasPermission(perms, "settings:write")) {
    redirect("/settings");
  }
  if (hasPermission(perms, "audit:read")) {
    redirect("/audit");
  }
  redirect("/forbidden");
}
