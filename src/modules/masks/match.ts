/**
 * One mask row for a screen number.
 * The same rules are in rtu_mask_lookup. A letter is a digit class:
 * one letter is one digit, two letters are two digits. A letter may
 * equal a digit written in the same mask. A hyphen is stored and shown,
 * and it is not a digit or a letter. The row with more literal digits
 * wins. An earlier file row does not win by itself.
 */

import { FREE_CALL_DIRECTION, MOBILE_RF_DIRECTION } from "@/modules/rtu/columns";

export const MASK_CATEGORY_MOBILE = "Мобильный";
export const MASK_CATEGORY_FREE = "Бесплатный вызов";
export const MASK_CATEGORY_CITY = "Городской";

const MASK_BODY = /^[0-9A-DX-Z]+$/;
const MASK_TEXT = /^[0-9A-DX-Z-]+$/;
const DIGITS = /^\d+$/;

/** Letters and digits of a mask. A hyphen is not one of them. */
export function maskSignificant(mask: string): string {
  return mask.replace(/-/g, "");
}

function isMaskLetter(symbol: string): boolean {
  return (symbol >= "A" && symbol <= "D") || (symbol >= "X" && symbol <= "Z");
}

export type MaskCandidate = {
  sortIndex: number;
  digitLength: number;
  category: string;
  abc: string | null;
  mask: string;
  maskType: string | null;
  purchase: string | null;
  premium: string | null;
};

export type MaskMatch = {
  mask: string;
  maskType: string;
  purchase: string;
  premium: string;
};

export type MaskMatchInput = {
  city: string;
  cityAlert: boolean;
  abc: string;
  telephone: string;
};

/** Category of the mask catalog, or null when the row has no mask. */
export function maskCategory(city: string, cityAlert: boolean): string | null {
  const trimmed = city.trim();
  if (trimmed === MOBILE_RF_DIRECTION) return MASK_CATEGORY_MOBILE;
  if (trimmed === FREE_CALL_DIRECTION) return MASK_CATEGORY_FREE;
  if (cityAlert || trimmed.length === 0) return null;
  return MASK_CATEGORY_CITY;
}

/**
 * 0 is the screen ABC, 1 is that ABC without one leading 7, 2 is an empty
 * catalog ABC. Null means this catalog ABC is a different code.
 */
export function maskAbcRank(
  maskAbc: string | null | undefined,
  screenAbc: string,
): number | null {
  const abc = maskAbc?.trim() ?? "";
  if (!abc) return 2;
  if (abc === screenAbc) return 0;
  if (screenAbc.startsWith("7") && abc === screenAbc.slice(1)) return 1;
  return null;
}

/** True when the local number is an instance of the mask. */
export function maskFits(mask: string, telephone: string): boolean {
  if (!DIGITS.test(telephone) || !MASK_TEXT.test(mask)) return false;
  const significant = maskSignificant(mask);
  if (significant.length !== telephone.length || !MASK_BODY.test(significant))
    return false;
  const letterDigit = new Map<string, string>();
  for (let i = 0; i < significant.length; i++) {
    const symbol = significant[i]!;
    const digit = telephone[i]!;
    if (symbol >= "0" && symbol <= "9") {
      if (symbol !== digit) return false;
      continue;
    }
    const previous = letterDigit.get(symbol);
    if (previous == null) {
      for (const used of letterDigit.values()) {
        if (used === digit) return false;
      }
      letterDigit.set(symbol, digit);
      continue;
    }
    if (previous !== digit) return false;
  }
  return true;
}

export function maskLiterals(mask: string): number {
  let count = 0;
  for (const symbol of mask) {
    if (symbol >= "0" && symbol <= "9") count += 1;
  }
  return count;
}

/** Positions whose letter occurs more than once. A hyphen is not a letter. */
export function maskRepeats(mask: string): number {
  const counts = new Map<string, number>();
  for (const symbol of mask) {
    if (!isMaskLetter(symbol)) continue;
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  let count = 0;
  for (const symbol of mask) {
    if ((counts.get(symbol) ?? 0) > 1) count += 1;
  }
  return count;
}

function better(
  next: { literals: number; repeats: number; rank: number; sortIndex: number },
  best: { literals: number; repeats: number; rank: number; sortIndex: number },
): boolean {
  if (next.literals !== best.literals) return next.literals > best.literals;
  if (next.repeats !== best.repeats) return next.repeats > best.repeats;
  if (next.rank !== best.rank) return next.rank < best.rank;
  return next.sortIndex < best.sortIndex;
}

/** The one catalog row for this screen number, or null. */
export function matchNumberMask(
  input: MaskMatchInput,
  rows: readonly MaskCandidate[],
): MaskMatch | null {
  const category = maskCategory(input.city, input.cityAlert);
  if (!category) return null;
  const telephone = input.telephone.trim();
  if (!DIGITS.test(telephone) || telephone.length < 5 || telephone.length > 7)
    return null;
  const abc = input.abc.trim();
  let best: MaskCandidate | null = null;
  let bestScore: {
    literals: number;
    repeats: number;
    rank: number;
    sortIndex: number;
  } | null = null;
  for (const row of rows) {
    if (row.category !== category || row.digitLength !== telephone.length) continue;
    const rank = maskAbcRank(row.abc, abc);
    if (rank == null || !maskFits(row.mask, telephone)) continue;
    const score = {
      literals: maskLiterals(row.mask),
      repeats: maskRepeats(row.mask),
      rank,
      sortIndex: row.sortIndex,
    };
    if (best == null || bestScore == null || better(score, bestScore)) {
      best = row;
      bestScore = score;
    }
  }
  if (best == null) return null;
  return {
    mask: best.mask,
    maskType: best.maskType ?? "",
    purchase: best.purchase ?? "",
    premium: best.premium ?? "",
  };
}
