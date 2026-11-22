/**
 * Free PSTN misses leave free_numbers after decorate. The summary letter reads this table.
 */

/** Provider literals only. Embedded in publish SQL like the other DELETE slices. */
export function clearFreePstnExcludedSql(provider: string): string {
  return `DELETE FROM numbering_free_pstn_excluded WHERE provider = '${provider}'`;
}
