/**
 * Supplier workbook. Two accepted header shapes.
 * The legacy file starts with «Категория», «Поставщик», «Город», «Номер».
 * A geography export names the phone column «Телефонный номер».
 * «Город» is not stored. A legacy prefix wins over a later phone header.
 */

import ExcelJS from "exceljs";
import { CATEGORY_FIELD, CATEGORY_MAX_LENGTH } from "@/modules/phones/category";
import { SUPPLIER_FIELD, SUPPLIER_MAX_LENGTH } from "@/modules/phones/supplier";

export const SUPPLIER_NUMBER_HEADER = "Номер";
export const SUPPLIER_TELEPHONE_HEADER = "Телефонный номер";
export const SUPPLIER_CITY_HEADER = "Город";

const FILE_HEADERS = [
  CATEGORY_FIELD,
  SUPPLIER_FIELD,
  SUPPLIER_CITY_HEADER,
  SUPPLIER_NUMBER_HEADER,
] as const;

const NAMED_HEADERS = [
  CATEGORY_FIELD,
  SUPPLIER_FIELD,
  SUPPLIER_CITY_HEADER,
  SUPPLIER_TELEPHONE_HEADER,
] as const;

const HEADER_DETAIL =
  "Первая строка должна начинаться со столбцов «Категория», «Поставщик», «Город», «Номер» или содержать по одному столбцу «Категория», «Поставщик», «Город» и «Телефонный номер»";

type SheetColumns = {
  category: number;
  supplier: number;
  city: number;
  number: number;
  numberHeader: string;
};

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
  const located = locateColumns(headerRow);
  if (!located.ok) return located;

  const rows: SupplierFileRow[] = [];
  const details: string[] = [];
  const last = sheet.rowCount;
  const columns = located.columns;
  for (let rowNumber = 2; rowNumber <= last; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const category = cellText(row.getCell(columns.category).value);
    const supplier = cellText(row.getCell(columns.supplier).value);
    const city = cellText(row.getCell(columns.city).value);
    const number = cellText(row.getCell(columns.number).value);
    if (!category && !supplier && !city && !number) continue;
    if (!number) {
      details.push(`Строка ${rowNumber}: пустой «${columns.numberHeader}»`);
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

function headerTexts(row: ExcelJS.Row): string[] {
  const width = Math.max(row.cellCount, row.actualCellCount);
  const headers: string[] = [];
  for (let index = 1; index <= width; index++) {
    headers.push(cellText(row.getCell(index).value));
  }
  return headers;
}

function isLegacyHeader(headers: readonly string[]): boolean {
  return FILE_HEADERS.every((header, index) => headers[index] === header);
}

function locateColumns(
  row: ExcelJS.Row,
): { ok: true; columns: SheetColumns } | { ok: false; error: string; details: string[] } {
  const headers = headerTexts(row);
  if (isLegacyHeader(headers)) {
    return {
      ok: true,
      columns: {
        category: 1,
        supplier: 2,
        city: 3,
        number: 4,
        numberHeader: SUPPLIER_NUMBER_HEADER,
      },
    };
  }

  const named = new Set<string>(NAMED_HEADERS);
  const hits = new Map<string, number[]>();
  headers.forEach((header, index) => {
    if (!named.has(header)) return;
    const columns = hits.get(header) ?? [];
    columns.push(index + 1);
    hits.set(header, columns);
  });
  const details = [HEADER_DETAIL];
  const indexes = {} as Record<(typeof NAMED_HEADERS)[number], number>;
  for (const header of NAMED_HEADERS) {
    const columns = hits.get(header) ?? [];
    if (columns.length === 0) details.push(`Нет столбца «${header}»`);
    if (columns.length > 1) details.push(`Столбец «${header}» повторяется`);
    if (columns.length === 1) indexes[header] = columns[0]!;
  }
  if (details.length > 1) {
    return { ok: false, error: "В файле нет нужных столбцов", details };
  }
  return {
    ok: true,
    columns: {
      category: indexes[CATEGORY_FIELD],
      supplier: indexes[SUPPLIER_FIELD],
      city: indexes[SUPPLIER_CITY_HEADER],
      number: indexes[SUPPLIER_TELEPHONE_HEADER],
      numberHeader: SUPPLIER_TELEPHONE_HEADER,
    },
  };
}
