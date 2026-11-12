/**
 * Screen grouping for «Покупка» and «Премиум».
 * The stored string stays the filter token. Digits are grouped as text,
 * so a fraction is not rounded and a long integer is not passed through Number.
 */

const AMOUNT = /^(-?)(\d+)(?:([.,])(\d+))?$/;

/** Space-grouped amount. Non-numeric text is returned unchanged. */
export function formatAmountCell(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const compact = trimmed.replace(/[\s\u00a0]/g, "");
  const match = AMOUNT.exec(compact);
  if (!match) return value;
  const sign = match[1] ?? "";
  const digits = match[2] ?? "";
  const separator = match[3];
  const fraction = match[4];
  const grouped = groupDigits(digits);
  return sign + grouped + (separator ? separator + fraction : "");
}

/** Facet label. An empty token stays «(пусто)». */
export function formatStoredAmount(value: string): string {
  if (value === "" || value === "__empty__") return "(пусто)";
  return formatAmountCell(value);
}

/**
 * Menu search for a stored amount.
 * «1 500» and «1500» hit the same digits. «(пусто)» stays the empty label.
 */
export function amountFacetQueryHits(token: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (token === "" || token === "__empty__") return "(пусто)".includes(needle);
  const shown = formatAmountCell(token).toLowerCase();
  if (shown.includes(needle)) return true;
  const compactNeedle = needle.replace(/[\s\u00a0]/g, "");
  if (!compactNeedle) return false;
  return token
    .replace(/[\s\u00a0]/g, "")
    .toLowerCase()
    .includes(compactNeedle);
}

function groupDigits(digits: string): string {
  const parts: string[] = [];
  let rest = digits;
  while (rest.length > 3) {
    parts.unshift(rest.slice(-3));
    rest = rest.slice(0, -3);
  }
  parts.unshift(rest);
  return parts.join(" ");
}
