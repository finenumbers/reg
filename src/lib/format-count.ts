const THIN_NBSP = "\u202F";

/** Group integer quantities with U+202F (narrow no-break space). */
export function formatCount(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
}
