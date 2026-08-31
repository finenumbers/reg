import { Prisma } from "@/generated/prisma/client";
import type { DescriptionPair } from "@/modules/traffic/sides-refresh/diff";

export function buildSidesUpdateSql(
  side: "a" | "b",
  pairs: DescriptionPair[],
): Prisma.Sql {
  if (pairs.length === 0) {
    throw new Error("buildSidesUpdateSql requires at least one pair");
  }
  const tuples = pairs.map(
    (pair) => Prisma.sql`(${pair.phone}, ${pair.description})`,
  );
  if (side === "a") {
    return Prisma.sql`
      UPDATE cdr_records AS c
      SET side_a = v.descr
      FROM (VALUES ${Prisma.join(tuples)}) AS v(phone, descr)
      WHERE c.bill_ani = v.phone
        AND c.side_a IS DISTINCT FROM v.descr
    `;
  }
  return Prisma.sql`
    UPDATE cdr_records AS c
    SET side_b = v.descr
    FROM (VALUES ${Prisma.join(tuples)}) AS v(phone, descr)
    WHERE c.bill_dnis = v.phone
      AND c.side_b IS DISTINCT FROM v.descr
  `;
}
