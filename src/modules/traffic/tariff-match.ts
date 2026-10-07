/**
 * Longest ABC prefix against a tariff snapshot.
 * Equal length keeps the earlier file row. Shared by rating and call geography.
 */

export type TariffAbcRate = {
  direction: string;
  abc: string;
  sortIndex: number;
};

export function matchTariffAbc<T extends TariffAbcRate>(
  number: string,
  rates: readonly T[],
): T | null {
  let best: T | null = null;
  for (const rate of rates) {
    if (!rate.abc || !number.startsWith(rate.abc)) continue;
    if (
      !best ||
      rate.abc.length > best.abc.length ||
      (rate.abc.length === best.abc.length && rate.sortIndex < best.sortIndex)
    ) {
      best = rate;
    }
  }
  return best;
}
