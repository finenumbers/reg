/**
 * Free PSTN misses leave free_numbers after decorate.
 * Summary registry «Ошибки» counts this table; the letter does not list the rows.
 */

/** Provider literals only. Embedded in publish SQL like the other DELETE slices. */
export function clearFreePstnExcludedSql(provider: string): string {
  return `DELETE FROM numbering_free_pstn_excluded WHERE provider = '${provider}'`;
}
