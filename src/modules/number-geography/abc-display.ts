/**
 * Screen text for «ABC» and the yellow search marks on «ABC» and «Номер».
 * The stored code stays unchanged. Country code 7 is wrapped only when the
 * trimmed number is exactly those two cells, or 7 plus those cells.
 * Marks are literal non-overlapping hits in the raw number. The space and
 * the parentheses are never hits.
 */

export type DigitMark = {
  text: string;
  hit: boolean;
};

export type GeographyDigitMarks = {
  abc: DigitMark[];
  telephone: DigitMark[];
};

type Slot = {
  ch: string;
  digit: number | null;
};

type Split = {
  inner: string | null;
  abc: string;
  /** Trimmed index of the first «Номер» digit. Null when the cells do not rebuild the number. */
  telephoneAt: number | null;
};

function countrySlots(inner: string): Slot[] {
  const slots: Slot[] = [{ ch: "7", digit: 0 }];
  if (!inner) return slots;
  slots.push({ ch: " ", digit: null }, { ch: "(", digit: null });
  for (let i = 0; i < inner.length; i++) slots.push({ ch: inner[i]!, digit: i + 1 });
  slots.push({ ch: ")", digit: null });
  return slots;
}

function splitOf(
  number: string,
  abc: string,
  telephone: string,
): { lead: number; split: Split } {
  const trimmed = number.trim();
  const lead = trimmed.length === 0 ? 0 : number.indexOf(trimmed);
  if (abc !== "" && trimmed === abc + telephone && abc.startsWith("7")) {
    return {
      lead,
      split: { inner: abc.slice(1), abc, telephoneAt: abc.length },
    };
  }
  if (abc !== "" && !abc.startsWith("7") && trimmed === `7${abc}${telephone}`) {
    return {
      lead,
      split: { inner: abc, abc, telephoneAt: abc.length + 1 },
    };
  }
  if (abc !== "" && trimmed === abc + telephone) {
    return { lead, split: { inner: null, abc, telephoneAt: abc.length } };
  }
  return { lead, split: { inner: null, abc, telephoneAt: null } };
}

function abcSlots(split: Split): Slot[] {
  if (split.inner != null) return countrySlots(split.inner);
  const aligned = split.telephoneAt != null;
  return [...split.abc].map((ch, i) => ({ ch, digit: aligned ? i : null }));
}

function telephoneSlots(telephone: string, at: number | null): Slot[] {
  return [...telephone].map((ch, i) => ({ ch, digit: at == null ? null : at + i }));
}

/** Case folding that would change the length cannot share indexes with the raw number. */
function hitDigits(raw: string, query: string | undefined, lead: number): Set<number> {
  const needle = query?.trim() ?? "";
  const hits = new Set<number>();
  if (!needle) return hits;
  const foldedNeedle = needle.toLowerCase();
  const foldedHay = raw.toLowerCase();
  if (foldedHay.length !== raw.length || foldedNeedle.length !== needle.length)
    return hits;
  let from = 0;
  while (from <= foldedHay.length - foldedNeedle.length) {
    const at = foldedHay.indexOf(foldedNeedle, from);
    if (at < 0) break;
    for (let i = at; i < at + foldedNeedle.length; i++) {
      const digit = i - lead;
      if (digit >= 0) hits.add(digit);
    }
    from = at + foldedNeedle.length;
  }
  return hits;
}

function collapse(slots: Slot[], hits: Set<number>): DigitMark[] {
  const out: DigitMark[] = [];
  for (const slot of slots) {
    const hit = slot.digit != null && hits.has(slot.digit);
    const prev = out[out.length - 1];
    if (prev && prev.hit === hit) prev.text += slot.ch;
    else out.push({ text: slot.ch, hit });
  }
  return out;
}

export function geographyAbcText(number: string, abc: string, telephone: string): string {
  const { split } = splitOf(number, abc, telephone);
  return collapse(abcSlots(split), new Set())
    .map((mark) => mark.text)
    .join("");
}

export function geographyDigitMarks(
  number: string,
  abc: string,
  telephone: string,
  query?: string,
): GeographyDigitMarks {
  const { lead, split } = splitOf(number, abc, telephone);
  const hits = hitDigits(number, query, lead);
  return {
    abc: collapse(abcSlots(split), hits),
    telephone: collapse(telephoneSlots(telephone, split.telephoneAt), hits),
  };
}
