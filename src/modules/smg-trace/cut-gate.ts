/**
 * The one-time cut (drop cards, blank CDR labels, delete the Parking journal)
 * waits while vacuum or a month purge holds `smg_cdr_records`. After the cut,
 * a later purge does not delay the drain.
 */
export function deferTraceCut(input: {
  vacuum: boolean;
  purge: boolean;
  journalDone: boolean;
  hasCurrentLiveMark: boolean;
}): boolean {
  const pending = !input.journalDone || !input.hasCurrentLiveMark;
  if (!pending) return false;
  return input.vacuum || input.purge;
}
