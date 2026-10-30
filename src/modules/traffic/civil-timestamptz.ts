/**
 * Civil clock as timestamptz, or NULL when the calendar cannot exist.
 * `make_timestamptz` throws on 31 February and hour 25, and that throw aborts
 * the whole statement. The unused branch of CASE is not evaluated.
 * Keep this in step with `isAcceptableCivilClock`.
 */

import { Prisma } from "@/generated/prisma/client";
import { CDR_DATE_CIVIL_REGEX } from "@/modules/traffic/cdr-date-parts";

const CIVIL_PREFIX = new RegExp(CDR_DATE_CIVIL_REGEX);

function isLeapYear(year: number): boolean {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

/** True for a regex-shaped clock that PostgreSQL can store, including a fractional suffix. */
export function isAcceptableCivilClock(raw: string): boolean {
  const trimmed = raw.trim();
  if (!CIVIL_PREFIX.test(trimmed) || trimmed.length < 19) return false;
  const year = Number(trimmed.slice(0, 4));
  const month = Number(trimmed.slice(5, 7));
  const day = Number(trimmed.slice(8, 10));
  const hour = Number(trimmed.slice(11, 13));
  const minute = Number(trimmed.slice(14, 16));
  const second = Number(trimmed.slice(17, 19));
  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }
  const days = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maxDay = days[month] ?? 0;
  return day >= 1 && day <= maxDay;
}

/**
 * `source` is the text expression (already known to match the civil prefix).
 * `timeZone` is a SQL timezone, either a literal or a bound name.
 */
export function civilTimestamptzSql(source: Prisma.Sql, timeZone: Prisma.Sql): Prisma.Sql {
  const year = Prisma.sql`substring(${source} from 1 for 4)::int`;
  const month = Prisma.sql`substring(${source} from 6 for 2)::int`;
  const day = Prisma.sql`substring(${source} from 9 for 2)::int`;
  const hour = Prisma.sql`substring(${source} from 12 for 2)::int`;
  const minute = Prisma.sql`substring(${source} from 15 for 2)::int`;
  const second = Prisma.sql`substring(${source} from 18 for 2)::int`;
  const leap = Prisma.sql`(
    ${year} % 400 = 0
    OR (${year} % 4 = 0 AND ${year} % 100 <> 0)
  )`;
  return Prisma.sql`CASE
    WHEN ${year} BETWEEN 1 AND 9999
     AND ${month} BETWEEN 1 AND 12
     AND ${hour} BETWEEN 0 AND 23
     AND ${minute} BETWEEN 0 AND 59
     AND ${second} BETWEEN 0 AND 59
     AND ${day} BETWEEN 1 AND (
       CASE ${month}
         WHEN 1 THEN 31
         WHEN 2 THEN CASE WHEN ${leap} THEN 29 ELSE 28 END
         WHEN 3 THEN 31
         WHEN 4 THEN 30
         WHEN 5 THEN 31
         WHEN 6 THEN 30
         WHEN 7 THEN 31
         WHEN 8 THEN 31
         WHEN 9 THEN 30
         WHEN 10 THEN 31
         WHEN 11 THEN 30
         WHEN 12 THEN 31
         ELSE 0
       END
     )
    THEN make_timestamptz(
      ${year},
      ${month},
      ${day},
      ${hour},
      ${minute},
      ${second},
      ${timeZone}
    )
    ELSE NULL
  END`;
}
