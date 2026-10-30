/**
 * Supplier workbook: columns «Поставщик» and «Номер». Extra columns are ignored.
 */

import ExcelJS from "exceljs";
import { SUPPLIER_FIELD, SUPPLIER_MAX_LENGTH } from "@/modules/phones/supplier";

export const SUPPLIER_NUMBER_HEADER = "Номер";

export type SupplierFileRow = {
  /** 1-based worksheet row, header is 1. */
  rowNumber: number;
  number: string;
  /** Trimmed. Empty clears the supplier. */
  supplier: string;
};

export type SupplierXlsxResult =
  | { ok: true; rows: SupplierFileRow[] }
  | { ok: false; error: string; details: string[] };

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return "";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  }
  return "";
}

export async function parseSupplierXlsx(
  buffer: Buffer,
): Promise<SupplierXlsxResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return {
      ok: false,
      error: "Файл XLSX не прочитан",
      details: ["Ожидается книга Excel со столбцами «Поставщик» и «Номер»"],
    };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return {
      ok: false,
      error: "Файл XLSX не прочитан",
      details: ["В книге нет листов"],
    };
  }

  const headerRow = sheet.getRow(1);
  let supplierCol = 0;
  let numberCol = 0;
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const header = cellText(cell.value);
    if (header === SUPPLIER_FIELD) supplierCol = col;
    if (header === SUPPLIER_NUMBER_HEADER) numberCol = col;
  });
  if (supplierCol === 0 || numberCol === 0) {
    return {
      ok: false,
      error: "В файле нет нужных столбцов",
      details: ["Первая строка должна содержать «Поставщик» и «Номер»"],
    };
  }

  const rows: SupplierFileRow[] = [];
  const details: string[] = [];
  const last = sheet.rowCount;
  for (let rowNumber = 2; rowNumber <= last; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const supplier = cellText(row.getCell(supplierCol).value);
    const number = cellText(row.getCell(numberCol).value);
    if (!supplier && !number) continue;
    if (!number) {
      details.push(`Строка ${rowNumber}: пустой «Номер»`);
      continue;
    }
    if (supplier.length > SUPPLIER_MAX_LENGTH) {
      details.push(
        `Строка ${rowNumber}: «Поставщик» длиннее ${SUPPLIER_MAX_LENGTH} символов`,
      );
      continue;
    }
    rows.push({ rowNumber, number, supplier });
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: "Файл поставщиков не принят",
      details,
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      error: "Файл поставщиков не принят",
      details: ["Нет строк с номером"],
    };
  }
  return { ok: true, rows };
}
