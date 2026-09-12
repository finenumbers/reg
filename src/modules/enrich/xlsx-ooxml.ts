/**
 * Read OOXML parts from an XLSX zip without going through the ExcelJS model.
 */

import { execFileSync } from "node:child_process";

export function readXlsxEntry(xlsxPath: string, entry: string): string {
  return execFileSync("unzip", ["-p", xlsxPath, entry], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function xlsxFillRgbs(stylesXml: string): string[] {
  const rgbs: string[] = [];
  const fills = stylesXml.match(/<fill>[\s\S]*?<\/fill>/g) ?? [];
  for (const fill of fills) {
    const rgb = /<(?:fgColor|bgColor) rgb="([^"]+)"/.exec(fill);
    if (rgb?.[1]) rgbs.push(rgb[1].toUpperCase());
  }
  return rgbs;
}

export function xlsxCellXfs(stylesXml: string): Array<{
  fillId: number;
  applyFill: boolean;
}> {
  const block =
    /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  return [...block.matchAll(/<xf\b([^>]*)\/?>/g)].map((match) => {
    const attrs = match[1] ?? "";
    return {
      fillId: Number(/fillId="(\d+)"/.exec(attrs)?.[1] ?? 0),
      applyFill: /applyFill="1"/.test(attrs),
    };
  });
}

export function xlsxSheetStyleIds(sheetXml: string): number[] {
  return [...sheetXml.matchAll(/\bs="(\d+)"/g)].map((match) => Number(match[1]));
}
