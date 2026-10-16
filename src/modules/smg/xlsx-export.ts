import ExcelJS from "exceljs";
import { guardExcelText } from "@/modules/enrich/formula-guard";
import { EXCEL_MAX_ROWS } from "@/modules/enrich/types";
import {
  SMG_COLUMNS,
  SMG_FIELDS,
  SMG_HEADER_LABELS,
  type SmgField,
} from "@/modules/smg/columns";
import {
  SMG_SUMMARY_COLUMNS,
  SMG_SUMMARY_LABELS,
  smgSummaryCellText,
} from "@/modules/smg/summary";

export const SMG_EXPORT_PAGE_SIZE = 2000;

export type SmgExportLayout = "calls" | "traffic";

export type SmgExportColumn = {
  header: string;
  cell: (row: Record<SmgField, string>) => string;
};

export class SmgExportTooLargeError extends Error {
  constructor(total: number) {
    super(
      `Слишком много строк (${total}). Максимум листа Excel — ${EXCEL_MAX_ROWS}`,
    );
    this.name = "SmgExportTooLargeError";
  }
}

export function smgExportColumns(layout: SmgExportLayout): SmgExportColumn[] {
  if (layout === "calls") {
    return SMG_COLUMNS.map((column) => ({
      header: column.label,
      cell: (row) => row[column.field] ?? "",
    }));
  }
  const shown = new Set<string>(SMG_SUMMARY_COLUMNS);
  const screen = SMG_SUMMARY_COLUMNS.map((column) => ({
    header: SMG_SUMMARY_LABELS[column],
    cell: (row: Record<SmgField, string>) => smgSummaryCellText(column, row),
  }));
  const rest = SMG_FIELDS.filter((field) => !shown.has(field)).map((field) => ({
    header: SMG_HEADER_LABELS[field],
    cell: (row: Record<SmgField, string>) => row[field] ?? "",
  }));
  return [...screen, ...rest];
}

export function smgExportCell(
  column: SmgExportColumn,
  row: Record<SmgField, string>,
): string {
  return guardExcelText(column.cell(row));
}

export function smgExportFilename(
  layout: SmgExportLayout,
  month: string,
  device: string,
): string {
  const title = layout === "calls" ? "Звонки на SMG" : "Трафик SMG";
  const node = device.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
  return node ? `${title} ${month} ${node}.xlsx` : `${title} ${month}.xlsx`;
}

export function smgExportSheetName(layout: SmgExportLayout): string {
  return layout === "calls" ? "Звонки на SMG" : "Трафик SMG";
}

export function assertSmgExportRowCount(total: number): void {
  if (total > EXCEL_MAX_ROWS) throw new SmgExportTooLargeError(total);
}

/** Header style only. Body cells stay plain text. */
export async function writeSmgExportFile(opts: {
  layout: SmgExportLayout;
  filePath: string;
  eachRow: (visit: (row: Record<SmgField, string>) => Promise<void>) => Promise<void>;
}): Promise<number> {
  const columns = smgExportColumns(opts.layout);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: opts.filePath,
    useStyles: true,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet(smgExportSheetName(opts.layout));
  columns.forEach((column, index) => {
    const width = Math.min(36, Math.max(12, [...column.header].length + 2));
    sheet.getColumn(index + 1).width = width;
  });
  const header = sheet.addRow(columns.map((column) => column.header));
  header.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  header.commit();

  let written = 0;
  await opts.eachRow(async (row) => {
    const excelRow = sheet.addRow(
      columns.map((column) => smgExportCell(column, row)),
    );
    excelRow.commit();
    written += 1;
    if (written % 40 === 0) {
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
    }
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, written + 1), column: columns.length },
  };
  await sheet.commit();
  await workbook.commit();
  return written;
}
