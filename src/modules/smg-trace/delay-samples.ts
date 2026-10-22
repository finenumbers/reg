import { Prisma } from "@/generated/prisma/client";

/** `{}` when the card was parsed and had no reply. Never used for "not computed". */
export function integerArraySql(values: readonly number[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`ARRAY[]::integer[]`;
  return Prisma.sql`ARRAY[${Prisma.join(values)}]::integer[]`;
}

export function writeDelaySamplesSql(input: {
  deviceIp: string;
  tagNorm: string;
  dev: readonly number[];
  prod: readonly number[];
  parking: readonly number[];
}): Prisma.Sql {
  return Prisma.sql`
    UPDATE smg_call_traces
    SET af_ms_dev = ${integerArraySql(input.dev)},
        af_ms_prod = ${integerArraySql(input.prod)},
        af_ms_parking = ${integerArraySql(input.parking)}
    WHERE device_ip = ${input.deviceIp}
      AND tag_norm = ${input.tagNorm}
  `;
}

/** Loses the race with a save that already stored arrays for this card. */
export function fillDelaySampleSql(input: {
  id: string;
  dev: readonly number[];
  prod: readonly number[];
  parking: readonly number[];
}): Prisma.Sql {
  return Prisma.sql`
    UPDATE smg_call_traces
    SET af_ms_dev = ${integerArraySql(input.dev)},
        af_ms_prod = ${integerArraySql(input.prod)},
        af_ms_parking = ${integerArraySql(input.parking)}
    WHERE id = ${input.id}
      AND af_ms_dev IS NULL
  `;
}
