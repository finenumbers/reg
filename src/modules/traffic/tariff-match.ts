/**
 * Longest ABC prefix against a tariff snapshot.
 * Equal length keeps the earlier file row. Shared by rating and call geography.
 * A row is skipped when its digit length does not fit the number.
 */

/** ABC 73, 74, 78, and 79. The uploaded length cell is ignored. */
const RUSSIAN_ABC = /^(?:73|74|78|79)/;

/** Russian numbers are 7 and ten more digits. */
export const RUSSIAN_NUMBER_LENGTH = 11;

/** Same window as a B-number that is not a malformed outgoing call. */
export const TARIFF_NUMBER_MIN_LENGTH = 10;
export const TARIFF_NUMBER_MAX_LENGTH = 15;

export type TariffAbcRate = {
  direction: string;
  abc: string;
  sortIndex: number;
  /** Null or omitted: no length check, except Russian ABC, which is always 11. */
  digitLength?: number | null;
};

export function isRussianAbc(abc: string): boolean {
  return RUSSIAN_ABC.test(abc);
}

/**
 * Digits of length 10–15. A number starting with 7 is exactly 11 digits.
 * Shorter, longer, and non-digit numbers are not rated.
 */
export function isTariffNumberAdmitted(number: string): boolean {
  if (!/^\d{10,15}$/.test(number)) return false;
  if (number.startsWith("7") && number.length !== RUSSIAN_NUMBER_LENGTH) return false;
  return true;
}

function tariffAbcFitsLength(
  abc: string,
  digitLength: number | null | undefined,
  number: string,
): boolean {
  if (isRussianAbc(abc)) return number.length === RUSSIAN_NUMBER_LENGTH;
  if (digitLength == null) return true;
  return number.length === digitLength;
}

export function matchTariffAbc<T extends TariffAbcRate>(
  number: string,
  rates: readonly T[],
): T | null {
  if (!isTariffNumberAdmitted(number)) return null;
  let best: T | null = null;
  for (const rate of rates) {
    if (!rate.abc || !number.startsWith(rate.abc)) continue;
    if (!tariffAbcFitsLength(rate.abc, rate.digitLength, number)) continue;
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
