/**
 * PSTN range coverage for catalog decorate and the numbering summary.
 * Match key only: digits from the stored string, 11 on 7/8 become 7+national,
 * bare 10 digits become 7+those. Does not rewrite catalog e164. Exactly one
 * covering range is a hit; zero or several are not.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  PSTN_ELEVEN_DIGIT,
  PSTN_TEN_DIGIT,
} from "@/modules/rtu/sql";

/** 7 + 10 national digits for GiST range match, or NULL. */
export function matchE164Sql(rawExpr: Prisma.Sql): Prisma.Sql {
  const digits = Prisma.sql`regexp_replace(${rawExpr}, '[^0-9]', '', 'g')`;
  return Prisma.sql`(
    CASE
      WHEN ${digits} ~ ${PSTN_ELEVEN_DIGIT} THEN '7' || substring(${digits} FROM 2)
      WHEN ${digits} ~ ${PSTN_TEN_DIGIT} THEN '7' || ${digits}
      ELSE NULL
    END
  )`;
}

/**
 * Exactly one covering range fills operator/geography. Zero or several leave them.
 * The cast stays inside CASE. The span comparison is the GiST index expression.
 * Pass an expression that is already matchE164Sql(...) or a literal 7+10 form.
 */
export function pstnHitLateral(e164: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT
        CASE
          WHEN ${e164} ~ '^7[0-9]{10}$' THEN substring(${e164} from 2 for 3)
        END AS abc_key,
        CASE
          WHEN ${e164} ~ '^7[0-9]{10}$' THEN substring(${e164} from 5)::int
        END AS local_key
    ) digits ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS hits,
        min(s.operator) AS operator,
        min(s.gar_territory) AS geography
      FROM pstn_range_snapshot s
      WHERE digits.local_key IS NOT NULL
        AND s.abc = digits.abc_key
        AND int4range(s.range_start, s.range_end, '[]') @> digits.local_key
    ) pstn ON TRUE
  `;
}

export const PSTN_HIT_COLUMNS = Prisma.sql`
  CASE WHEN pstn.hits = 1 THEN btrim(pstn.operator) ELSE NULL END AS pstn_operator,
  CASE WHEN pstn.hits = 1 THEN btrim(pstn.geography) ELSE NULL END AS pstn_geography,
  CASE
    WHEN pstn.hits > 1 THEN 2
    WHEN pstn.hits = 1 THEN 1
    ELSE 0
  END AS pstn_hit_count
`;

/** True when there is not exactly one covering range (including no match key). */
export function pstnMissSql(e164: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    ${e164} IS NULL
    OR COALESCE(pstn.hits, 0) <> 1
  )`;
}
