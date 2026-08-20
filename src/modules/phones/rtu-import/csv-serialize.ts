/**
 * Serialize RTU import rows to semicolon CSV (softswitch style).
 * \N is emitted unquoted; data cells of «ТЕРМ. Зона» are unquoted
 * (empty or simple values, as in RTU sample exports). All other values
 * are double-quoted. Data rows append a trailing ;\N. Lines use CRLF.
 */

const TERM_ZONE_HEADER = "ТЕРМ. Зона";

export function serializeRtuCsv(
  headers: string[],
  rows: string[][],
): string {
  const lines: string[] = [headers.map((h) => escapeField(h)).join(";")];
  for (const row of rows) {
    const cells = headers.map((name, i) =>
      escapeField(row[i] ?? "", name),
    );
    // Softswitch sample import.csv data rows end with an extra ;\N
    lines.push(`${cells.join(";")};\\N`);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function escapeField(value: string, header?: string): string {
  if (value === "\\N") return "\\N";
  if (header === TERM_ZONE_HEADER && !/[;"\r\n]/.test(value)) {
    return value;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
