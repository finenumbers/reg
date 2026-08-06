/**
 * Seed: code-owned allowed_actions + RBAC roles/permissions + app_settings singleton
 * + optional admin bootstrap from ADMIN_* env (idempotent).
 *
 * Prefer app startup (`instrumentation.ts`) which also ensures baseline + bootstrap.
 * This script remains for one-shot ops: `npm run db:seed`.
 */

import "dotenv/config";
import { ensurePlatformBaseline } from "../src/modules/platform/ensure-baseline";
import { bootstrapAdminIfEmpty } from "../src/modules/users/bootstrap";
import { prisma } from "../src/lib/db";

async function main() {
  await ensurePlatformBaseline();
  console.log("Seed complete: roles, permissions, allowed_actions, app_settings");

  const bootstrap = await bootstrapAdminIfEmpty();
  console.log(
    "Admin bootstrap:",
    bootstrap.status,
    "reason" in bootstrap ? bootstrap.reason : bootstrap.username,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
