/**
 * Supplier workbook. One accepted header shape:
 * «Категория», «Поставщик», «ABC», «Номер».
 * ABC and «Номер» only identify the endpoint. They are not stored.
 * Display ABC like «7 (383)» is accepted; digits are matched later.
 */

import ExcelJS from "exceljs";
import { CATEGORY_FIELD, CATEGORY_MAX_LENGTH } from "@/modules/phones/category";
import { SUPPLIER_FIELD, SUPPLIER_MAX_LENGTH } from "@/modules/phones/supplier";

const SUPPLIER_ABC_HEADER = "ABC";
const SUPPLIER_NUMBER_HEADER = "Номер";

const FILE_HEADERS = [
  CATEGORY_FIELD,
  SUPPLIER_FIELD,
  SUPPLIER_ABC_HEADER,
  SUPPLIER_NUMBER_HEADER,
] as const;

const HEADER_DETAIL =
  "Первая строка должна начинаться со столбцов «Категория», «Поставщик», «ABC», «Номер»";

export type SupplierFileRow = {
  /** 1-based worksheet row, header is 1. */
  rowNumber: number;
  /** Trimmed screen ABC text, e.g. «7 (383)». Empty when the full number is in «Номер». */
  abc: string;
  /** Trimmed local part or full number when ABC is empty. */
  telephone: string;
  /** Trimmed. Empty clears the supplier. */
  supplier: string;
  /** Trimmed. Empty clears the category. */
  category: string;
};

type SupplierXlsxResult =
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

  const headers = headerTexts(sheet.getRow(1));
  if (!FILE_HEADERS.every((header, index) => headers[index] === header)) {
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
    const abc = cellText(row.getCell(3).value);
    const telephone = cellText(row.getCell(4).value);
    if (!category && !supplier && !abc && !telephone) continue;
    if (!telephone) {
      details.push(`Строка ${rowNumber}: пустой «${SUPPLIER_NUMBER_HEADER}»`);
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
    rows.push({ rowNumber, abc, telephone, supplier, category });
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

function headerTexts(row: ExcelJS.Row): string[] {
  const width = Math.max(row.cellCount, row.actualCellCount);
  const headers: string[] = [];
  for (let index = 1; index <= width; index++) {
    headers.push(cellText(row.getCell(index).value));
  }
  return headers;
}
