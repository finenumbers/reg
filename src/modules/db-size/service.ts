import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type SizeRow = { bytes: bigint | number | string };

/** On-disk size of the current project database, including every table and index. */
export async function readDatabaseBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<SizeRow[]>(Prisma.sql`
    SELECT pg_database_size(current_database())::bigint AS bytes
  `);
  const raw = rows[0]?.bytes ?? 0;
  const bytes = typeof raw === "bigint" ? Number(raw) : Number(raw);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}
