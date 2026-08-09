/**
 * Parse softswitch-style phones XLSX for RTU import
 * (Группы + Оконечное оборудование + Шлюзы).
 */

import ExcelJS from "exceljs";
import type { RtuConvertIssue, RtuSourceRow } from "@/modules/phones/rtu-import/types";

export const SHEET_GROUPS = "Группы";
export const SHEET_ENDPOINTS = "Оконечное оборудование";
export const SHEET_GATEWAYS = "Шлюзы";

const ENDPOINT_REQUIRED_HEADERS = [
  "Название",
  "Описание",
  "Номер оконечного оборудования",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Регистрация",
  "Зона",
  "ИНИЦ. список адресов",
  "ИНИЦ. порт",
  "ИНИЦ. зона",
  "ИНИЦ. емкость",
  "Входящие группы",
  "ТЕРМ. список адресов",
  "ТЕРМ. порт",
  "ТЕРМ. зона",
  "ТЕРМ. емкость",
  "Регистрационное имя",
  "Регистрационный пароль",
  "Список разрешенных адресов для регистрации",
] as const;

const GATEWAY_REQUIRED_HEADERS = [
  "Название",
  "Описание",
  "Инициирующее устройство",
  "Терминирующее устройство",
  "Протокол сигнализации",
  "ИНИЦ. список адресов",
  "ИНИЦ. порт",
  "ИНИЦ. зона",
  "ИНИЦ. емкость",
  "Входящие группы",
  "ТЕРМ. список адресов",
  "ТЕРМ. порт",
  "ТЕРМ. зона",
  "ТЕРМ. емкость",
] as const;

export type ParsedRtuWorkbook = {
  groupIdByName: Map<string, string>;
  endpoints: RtuSourceRow[];
  gateways: RtuSourceRow[];
  issues: RtuConvertIssue[];
};

function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const obj = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof obj.text === "string") return obj.text.trim();
    if (typeof obj.result === "string" || typeof obj.result === "number") {
      return String(obj.result).trim();
    }
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((p) => p.text ?? "").join("").trim();
    }
  }
  return String(value).trim();
}

function readHeaderMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  const row = ws.getRow(1);
  const max = Math.max(row.cellCount, 40);
  for (let c = 1; c <= max; c++) {
    const name = cellToString(row.getCell(c).value);
    if (!name) {
      if (c > 1 && map.size > 0) break;
      continue;
    }
    if (!map.has(name)) map.set(name, c);
  }
  return map;
}

function readDataRows(
  ws: ExcelJS.Worksheet,
  headerMap: Map<string, number>,
  sheet: RtuSourceRow["sheet"],
  required: readonly string[],
  issues: RtuConvertIssue[],
): RtuSourceRow[] {
  for (const h of required) {
    if (!headerMap.has(h)) {
      issues.push({
        message: `На листе «${ws.name}» нет колонки «${h}»`,
      });
    }
  }

  const rows: RtuSourceRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const excelRow = ws.getRow(r);
    const values: Record<string, string> = {};
    let any = false;
    for (const [name, col] of headerMap) {
      const v = cellToString(excelRow.getCell(col).value);
      values[name] = v;
      if (v) any = true;
    }
    if (!any) continue;
    rows.push({ sheet, rowNumber: r, values });
  }
  return rows;
}

/**
 * Load workbook from ArrayBuffer / Buffer. Collects structural issues (does not throw).
 */
export async function parseRtuXlsx(
  data: ArrayBuffer | Buffer | Uint8Array,
): Promise<ParsedRtuWorkbook> {
  const issues: RtuConvertIssue[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    const u8: Uint8Array = Buffer.isBuffer(data)
      ? new Uint8Array(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data);
    await wb.xlsx.load(u8 as never);
  } catch {
    return {
      groupIdByName: new Map(),
      endpoints: [],
      gateways: [],
      issues: [
        {
          message:
            "Не удалось прочитать файл как XLSX (файл повреждён или это не Excel)",
        },
      ],
    };
  }

  if (wb.worksheets.length === 0) {
    issues.push({ message: "В книге нет ни одного листа" });
  }

  const endpointsWs = wb.getWorksheet(SHEET_ENDPOINTS);
  const gatewaysWs = wb.getWorksheet(SHEET_GATEWAYS);

  if (!endpointsWs) {
    issues.push({ message: `Нет листа «${SHEET_ENDPOINTS}»` });
  }
  if (!gatewaysWs) {
    issues.push({ message: `Нет листа «${SHEET_GATEWAYS}»` });
  }

  // Groups sheet in the uploaded XLSX is ignored for name→ID mapping;
  // convertRtuXlsxToCsv injects the catalog from routing_groups (DB).
  const groupIdByName = new Map<string, string>();

  const endpoints =
    endpointsWs != null
      ? readDataRows(
          endpointsWs,
          readHeaderMap(endpointsWs),
          "endpoints",
          ENDPOINT_REQUIRED_HEADERS,
          issues,
        )
      : [];
  const gateways =
    gatewaysWs != null
      ? readDataRows(
          gatewaysWs,
          readHeaderMap(gatewaysWs),
          "gateways",
          GATEWAY_REQUIRED_HEADERS,
          issues,
        )
      : [];

  if (
    endpointsWs &&
    gatewaysWs &&
    endpoints.length === 0 &&
    gateways.length === 0
  ) {
    issues.push({
      message:
        "Нет ни одной строки данных на листах «Оконечное оборудование» и «Шлюзы»",
    });
  }

  return { groupIdByName, endpoints, gateways, issues };
}
