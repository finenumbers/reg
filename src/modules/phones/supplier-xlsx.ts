/**
 * Supplier workbook. The first four headers are fixed:
 * «Категория», «Поставщик», «Город», «Номер».
 * Columns to the right are ignored. «Город» is not stored.
 */

import ExcelJS from "exceljs";
import { CATEGORY_FIELD, CATEGORY_MAX_LENGTH } from "@/modules/phones/category";
import { SUPPLIER_FIELD, SUPPLIER_MAX_LENGTH } from "@/modules/phones/supplier";

export const SUPPLIER_NUMBER_HEADER = "Номер";
export const SUPPLIER_CITY_HEADER = "Город";

const FILE_HEADERS = [
  CATEGORY_FIELD,
  SUPPLIER_FIELD,
  SUPPLIER_CITY_HEADER,
  SUPPLIER_NUMBER_HEADER,
] as const;

const HEADER_DETAIL =
  "Первая строка должна начинаться со столбцов «Категория», «Поставщик», «Город», «Номер»";

export type SupplierFileRow = {
  /** 1-based worksheet row, header is 1. */
  rowNumber: number;
  number: string;
  /** Trimmed. Empty clears the supplier. */
  supplier: string;
  /** Trimmed. Empty clears the category. */
  category: string;
};

export type SupplierXlsxResult =
  { ok: true; rows: SupplierFileRow[] } | { ok: false; error: string; details: string[] };

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
      return value.richText
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    }
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
  }
  return "";
}

export async function parseSupplierXlsx(buffer: Buffer): Promise<SupplierXlsxResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return {
      ok: false,
      error: "Файл XLSX не прочитан",
      details: [HEADER_DETAIL],
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
  const headers = FILE_HEADERS.map((_, index) =>
    cellText(headerRow.getCell(index + 1).value),
  );
  if (headers.some((header, index) => header !== FILE_HEADERS[index])) {
    return {
      ok: false,
      error: "В файле нет нужных столбцов",
      details: [HEADER_DETAIL],
    };
  }

  const rows: SupplierFileRow[] = [];
  const details: string[] = [];
  const last = sheet.rowCount;
  for (let rowNumber = 2; rowNumber <= last; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const category = cellText(row.getCell(1).value);
    const supplier = cellText(row.getCell(2).value);
    const city = cellText(row.getCell(3).value);
    const number = cellText(row.getCell(4).value);
    if (!category && !supplier && !city && !number) continue;
    if (!number) {
      details.push(`Строка ${rowNumber}: пустой «Номер»`);
      continue;
    }
    if (category.length > CATEGORY_MAX_LENGTH) {
      details.push(
        `Строка ${rowNumber}: «Категория» длиннее ${CATEGORY_MAX_LENGTH} символов`,
      );
    }
    if (supplier.length > SUPPLIER_MAX_LENGTH) {
      details.push(
        `Строка ${rowNumber}: «Поставщик» длиннее ${SUPPLIER_MAX_LENGTH} символов`,
      );
    }
    if (category.length > CATEGORY_MAX_LENGTH || supplier.length > SUPPLIER_MAX_LENGTH) {
      continue;
    }
    rows.push({ rowNumber, number, supplier, category });
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
