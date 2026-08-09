/**
 * Serialize RTU import rows to semicolon CSV (softswitch style).
 * \N is emitted unquoted; all other values are double-quoted.
 * Data rows append a trailing ;\N (present in RTU sample exports).
 */

export function serializeRtuCsv(
  headers: string[],
  rows: string[][],
): string {
  const lines: string[] = [headers.map(escapeField).join(";")];
  for (const row of rows) {
    const cells = headers.map((_, i) => escapeField(row[i] ?? ""));
    // Softswitch sample import.csv data rows end with an extra ;\N
    lines.push(`${cells.join(";")};\\N`);
  }
  return `${lines.join("\n")}\n`;
}

function escapeField(value: string): string {
  if (value === "\\N") return "\\N";
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
