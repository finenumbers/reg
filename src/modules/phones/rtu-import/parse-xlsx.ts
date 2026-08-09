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
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data instanceof ArrayBuffer ? data : data);
    await wb.xlsx.load(buf);
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

  const groupsWs = wb.getWorksheet(SHEET_GROUPS);
  const endpointsWs = wb.getWorksheet(SHEET_ENDPOINTS);
  const gatewaysWs = wb.getWorksheet(SHEET_GATEWAYS);

  if (!groupsWs) {
    issues.push({ message: `Нет листа «${SHEET_GROUPS}»` });
  }
  if (!endpointsWs) {
    issues.push({ message: `Нет листа «${SHEET_ENDPOINTS}»` });
  }
  if (!gatewaysWs) {
    issues.push({ message: `Нет листа «${SHEET_GATEWAYS}»` });
  }

  const groupIdByName = new Map<string, string>();
  if (groupsWs) {
    const gHeaders = readHeaderMap(groupsWs);
    if (!gHeaders.has("ID") || !gHeaders.has("Название")) {
      if (!gHeaders.has("ID")) {
        issues.push({ message: `На листе «${SHEET_GROUPS}» нет колонки «ID»` });
      }
      if (!gHeaders.has("Название")) {
        issues.push({
          message: `На листе «${SHEET_GROUPS}» нет колонки «Название»`,
        });
      }
    } else {
      const idCol = gHeaders.get("ID")!;
      const nameCol = gHeaders.get("Название")!;
      for (let r = 2; r <= groupsWs.rowCount; r++) {
        const id = cellToString(groupsWs.getRow(r).getCell(idCol).value);
        const name = cellToString(groupsWs.getRow(r).getCell(nameCol).value);
        if (!id && !name) continue;
        if (!id || !name) {
          issues.push({
            message: `Лист «${SHEET_GROUPS}», строка ${r}: нужны и ID, и Название`,
          });
          continue;
        }
        if (groupIdByName.has(name)) {
          issues.push({
            message: `Лист «${SHEET_GROUPS}», строка ${r}: дублируется название группы «${name}»`,
          });
          continue;
        }
        groupIdByName.set(name, id);
      }
    }
  }

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
    groupsWs &&
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
