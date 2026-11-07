const THIN_NBSP = "\u202F";

/** Group integer quantities with U+202F (narrow no-break space). */
export function formatCount(n: number): string {
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
}

/** Toolbar checkbox on Registrations and Phones → «Транки с регистрацией». */
export function formatUnregisteredOnlyLabel(n: number): string {
  return `Без регистрации (${formatCount(n)})`;
}

/** Toolbar checkbox on phone endpoints and number geography. */
export function formatBlockedOnlyLabel(n: number): string {
  return `Блокировка (${formatCount(n)})`;
}

/** Toolbar checkbox on number geography. */
export function formatMissingRtuLabel(n: number): string {
  return `Нет в РТУ (${formatCount(n)})`;
}
