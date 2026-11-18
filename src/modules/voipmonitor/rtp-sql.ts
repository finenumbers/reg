/**
 * RTP word in SQL. The CASE matches `rtpMark`: a visible Out leg decides,
 * and In is read only when Out is not on the GUI host. An empty host is blank.
 */

import { Prisma } from "@/generated/prisma/client";
import { RTP_ABSENT, RTP_PRESENT } from "@/modules/voipmonitor/legs";

function legUrl(side: "in" | "out"): Prisma.Sql {
  return Prisma.raw(`btrim(COALESCE(l.voipmonitor_legs->'${side}'->>'url', ''))`);
}

/** Same host check the Calltrace cell uses. Side is the literal in or out. */
export function legOnHost(side: "in" | "out", host: string): Prisma.Sql {
  const url = legUrl(side);
  const scheme = Prisma.sql`(CASE WHEN ${url} ~* '^https://' THEN 'https' WHEN ${url} ~* '^http://' THEN 'http' ELSE '' END)`;
  const authority = Prisma.sql`lower(regexp_replace(COALESCE(substring(${url} from '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]*)'), ''), '^.*@', ''))`;
  const normalized = Prisma.sql`(
    CASE
      WHEN ${scheme} = 'https' AND right(${authority}, 4) = ':443'
        THEN left(${authority}, -4)
      WHEN ${scheme} = 'http' AND right(${authority}, 3) = ':80'
        THEN left(${authority}, -3)
      ELSE ${authority}
    END
  )`;
  return Prisma.sql`${scheme} <> '' AND ${normalized} = lower(${host})`;
}

/** Out decides. In is read only when the outgoing link is not on the GUI host. */
export function rtpExpr(host: string): Prisma.Sql {
  if (!host) return Prisma.sql`''`;
  const outAudio = Prisma.raw(`l.voipmonitor_legs->'out'->>'audio'`);
  const inAudio = Prisma.raw(`l.voipmonitor_legs->'in'->>'audio'`);
  return Prisma.sql`(
    CASE
      WHEN ${legOnHost("out", host)} AND ${outAudio} = 'true' THEN ${RTP_PRESENT}
      WHEN ${legOnHost("out", host)} AND ${outAudio} = 'false' THEN ${RTP_ABSENT}
      WHEN ${legOnHost("out", host)} THEN ''
      WHEN ${legOnHost("in", host)} AND ${inAudio} = 'true' THEN ${RTP_PRESENT}
      WHEN ${legOnHost("in", host)} AND ${inAudio} = 'false' THEN ${RTP_ABSENT}
      ELSE ''
    END
  )`;
}

export function rtpAbsentSql(host: string): Prisma.Sql {
  return Prisma.sql`${rtpExpr(host)} = ${RTP_ABSENT}`;
}
