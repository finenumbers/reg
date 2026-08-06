#!/usr/bin/env npx tsx
/**
 * Controlled admin bootstrap entrypoint.
 * Prefer `npm run db:seed` for full RBAC + bootstrap, or run this after migrate
 * when roles are already seeded and you only need the env admin user.
 *
 * Usage: npm run bootstrap:admin
 * Never prints ADMIN_PASSWORD.
 */

import "dotenv/config";
import { bootstrapAdminIfEmpty } from "../src/modules/users/bootstrap";

async function main() {
  const result = await bootstrapAdminIfEmpty();
  if (result.status === "skipped") {
    console.log(`bootstrap: skipped (${result.reason})`);
    return;
  }
  if (result.status === "created") {
    console.log(`bootstrap: created admin user "${result.username}"`);
    return;
  }
  console.log(
    `bootstrap: admin "${result.username}" already exists (roleEnsured=${result.roleEnsured})`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
