/**
 * Longest ABC prefix against a tariff snapshot.
 * Equal length keeps the earlier file row. Shared by rating and call geography.
 * A row is skipped when its digit length does not fit the number.
 */

/** ABC 73, 74, 78, and 79. Bold rows in the tariff table are the other codes. */
const RUSSIAN_ABC = /^(?:73|74|78|79)/;

/** Numbers and ABC codes that start with 7 are 7 and ten more digits. */
export const RUSSIAN_NUMBER_LENGTH = 11;

/** Same window as a B-number that is not a malformed outgoing call. */
export const TARIFF_NUMBER_MIN_LENGTH = 10;
export const TARIFF_NUMBER_MAX_LENGTH = 15;

export type TariffAbcRate = {
  direction: string;
  abc: string;
  sortIndex: number;
  /**
   * Null: any admitted length. An empty list matches nothing.
   * Ignored when the ABC starts with 7: that row is always 11 digits.
   */
  digitLengths: number[] | null;
};

export function isRussianAbc(abc: string): boolean {
  return RUSSIAN_ABC.test(abc);
}

/** Every ABC that starts with 7. The uploaded length cell is ignored. */
export function abcIgnoresDigitLengths(abc: string): boolean {
  return abc.startsWith("7");
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

/**
 * Dial prefixes that are an error unless their own ABC accepts the length.
 * None of these is a prefix of another. 887 and 889 start with 88.
 */
const CLOSED_DIAL_PREFIXES = ["887", "889", "83", "89", "0"] as const;

function closedDialPrefix(number: string): string | null {
  if (number.startsWith("*")) return "*";
  for (const prefix of CLOSED_DIAL_PREFIXES) {
    if (number.startsWith(prefix)) return prefix;
  }
  return null;
}

function tariffAbcFitsLength(
  abc: string,
  digitLengths: number[] | null,
  number: string,
): boolean {
  if (abcIgnoresDigitLengths(abc)) return number.length === RUSSIAN_NUMBER_LENGTH;
  if (digitLengths == null) return true;
  return digitLengths.includes(number.length);
}

function isTariffPrefix(number: string, abc: string): boolean {
  return abc.length > 0 && number.startsWith(abc);
}

export function formatDigitLengths(lengths: number[] | null): string | null {
  if (lengths == null) return null;
  return lengths.join("/");
}

/** Null is any admitted length. An empty string matches nothing. */
export function parseStoredDigitLengths(value: string | null): number[] | null {
  if (value == null) return null;
  if (value === "") return [];
  const lengths: number[] = [];
  for (const part of value.split("/")) {
    if (!/^1[0-5]$/.test(part)) return [];
    lengths.push(Number(part));
  }
  return lengths;
}

export function matchTariffAbc<T extends TariffAbcRate>(
  number: string,
  rates: readonly T[],
): T | null {
  if (!isTariffNumberAdmitted(number)) return null;
  let best: T | null = null;
  for (const rate of rates) {
    if (!isTariffPrefix(number, rate.abc)) continue;
    if (!tariffAbcFitsLength(rate.abc, rate.digitLengths, number)) continue;
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

/**
 * Outgoing B-number whose tariff prefix does not accept the length.
 * A closed prefix (0, 83, 89, 887, 889, or *) is a miss unless an ABC that
 * itself starts with that prefix accepts the length. That check is before the
 * 10–15 digit window, so a number on * is a miss. A shorter foreign ABC does not cover it.
 * A number that is already malformed returns false when it is not a closed prefix:
 * the caller handles that first.
 * A number on 7 is a miss when no ABC on 7 is a prefix. The length cell is not read.
 * Any other number is a miss only when a prefix exists and none of those rows accept the length.
 * No prefix at all is not a miss.
 */
export function tariffLengthMismatch(
  number: string,
  rates: readonly TariffAbcRate[],
): boolean {
  const trimmed = number.trim();
  const closed = closedDialPrefix(trimmed);
  if (closed) {
    return !rates.some(
      (rate) =>
        rate.abc.startsWith(closed) &&
        isTariffPrefix(trimmed, rate.abc) &&
        tariffAbcFitsLength(rate.abc, rate.digitLengths, trimmed),
    );
  }
  if (!isTariffNumberAdmitted(trimmed)) return false;
  if (trimmed.startsWith("7")) {
    return !rates.some(
      (rate) => abcIgnoresDigitLengths(rate.abc) && isTariffPrefix(trimmed, rate.abc),
    );
  }
  const prefixes = rates.filter((rate) => isTariffPrefix(trimmed, rate.abc));
  if (prefixes.length === 0) return false;
  return !prefixes.some((rate) =>
    tariffAbcFitsLength(rate.abc, rate.digitLengths, trimmed),
  );
}
