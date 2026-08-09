/**
 * Build UFW-import XLSX from phone gateway/endpoint snapshot (ephemeral).
 * Sheet layout matches ops sample: group | rtu | name | … with orange rtu column.
 */

import { prisma } from "@/lib/db";
import {
  formatExportTimestamp,
  replaceSheetData,
  workbookToBuffer,
  type ReplaceSheetStyleCellCtx,
} from "@/lib/xlsx-export";
import {
  REGISTRATION_FIELD,
  REGISTRATION_NO,
  REGISTRATION_YES,
  type PhoneRowData,
} from "@/modules/phones/types";
import ExcelJS from "exceljs";

export const UFW_HEADERS = [
  "group",
  "rtu",
  "name",
  "action",
  "direction",
  "interface",
  "fromAddress",
  "fromPort",
  "toAddress",
  "toPort",
  "protocol",
  "logMode",
  "ipv6",
  "appName",
  "ruleComment",
] as const;

export type UfwHeader = (typeof UFW_HEADERS)[number];

export const UFW_SHEET_GATEWAYS = "Шлюзы";
export const UFW_SHEET_REGISTERED = "Транки с регистрацией";
export const UFW_SHEET_UNREGISTERED = "Транки без регистрации";

export const UFW_GROUP_OPERATOR = "Operator";
export const UFW_GROUP_REGISTRATION = "Registration";
export const UFW_GROUP_TRUNK = "Trunk";

/** Orange fill from sample.xlsx column «rtu». */
export const UFW_RTU_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC000" },
};

const UFW_RTU_COL_INDEX = 1; // «rtu»

const FIELD_NAME = "Название";
const FIELD_DESC = "Описание";
const FIELD_INIT = "ИНИЦ. список адресов";
const FIELD_TERM = "ТЕРМ. список адресов";
const FIELD_REG_ADDR = "Список разрешенных адресов для регистрации";

export type UfwRuleRow = {
  group: string;
  rtu: string;
  name: string;
  fromAddress: string;
};

export type UfwExportSheets = {
  gateways: UfwRuleRow[];
  registered: UfwRuleRow[];
  unregistered: UfwRuleRow[];
};

export type UfwExportResult = {
  buffer: Buffer;
  filename: string;
};

function asStringRecord(data: unknown): PhoneRowData {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: PhoneRowData = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (v == null) out[k] = "";
    else if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else out[k] = "";
  }
  return out;
}

/** Split address lists on `;` / `,`, trim, drop empties, dedupe preserving order. */
export function mergeAddressLists(
  ...parts: Array<string | null | undefined>
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (part == null || part === "") continue;
    for (const token of String(part).split(/[;,]/)) {
      const t = token.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out.join(";");
}

function ruleFromData(
  group: string,
  data: PhoneRowData,
  address: string,
): UfwRuleRow | null {
  if (!address) return null;
  return {
    group,
    rtu: (data[FIELD_NAME] ?? "").trim(),
    name: (data[FIELD_DESC] ?? "").trim(),
    fromAddress: address,
  };
}

function mapGatewayToUfwRule(data: PhoneRowData): UfwRuleRow | null {
  const address = mergeAddressLists(data[FIELD_INIT], data[FIELD_TERM]);
  return ruleFromData(UFW_GROUP_OPERATOR, data, address);
}

function mapEndpointToUfwRule(data: PhoneRowData): UfwRuleRow | null {
  const reg = (data[REGISTRATION_FIELD] ?? "").trim();
  if (reg === REGISTRATION_YES) {
    const address = mergeAddressLists(data[FIELD_REG_ADDR]);
    return ruleFromData(UFW_GROUP_REGISTRATION, data, address);
  }
  if (reg === REGISTRATION_NO) {
    const address = mergeAddressLists(data[FIELD_INIT], data[FIELD_TERM]);
    return ruleFromData(UFW_GROUP_TRUNK, data, address);
  }
  return null;
}

export function buildUfwSheets(input: {
  gateways: PhoneRowData[];
  endpoints: PhoneRowData[];
}): UfwExportSheets {
  const gateways: UfwRuleRow[] = [];
  for (const data of input.gateways) {
    const row = mapGatewayToUfwRule(data);
    if (row) gateways.push(row);
  }

  const registered: UfwRuleRow[] = [];
  const unregistered: UfwRuleRow[] = [];
  for (const data of input.endpoints) {
    const row = mapEndpointToUfwRule(data);
    if (!row) continue;
    if (row.group === UFW_GROUP_REGISTRATION) registered.push(row);
    else unregistered.push(row);
  }

  return { gateways, registered, unregistered };
}

function ufwRuleToRow(rule: UfwRuleRow): string[] {
  return [
    rule.group,
    rule.rtu,
    rule.name,
    "ALLOW",
    "IN",
    "",
    rule.fromAddress,
    "",
    "any",
    "",
    "",
    "NONE",
    "false",
    "",
    "",
  ];
}

function styleRtuColumn(ctx: ReplaceSheetStyleCellCtx): void {
  if (ctx.colIndex !== UFW_RTU_COL_INDEX) return;
  ctx.cell.fill = UFW_RTU_FILL;
  const prev = ctx.cell.font ?? {};
  ctx.cell.font = {
    ...prev,
    name: "Calibri",
    size: 12,
    bold: ctx.rowIndex === -1 ? true : Boolean(prev.bold),
  };
}

function writeSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: UfwRuleRow[],
): void {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([...UFW_HEADERS].map(() => ""));
  replaceSheetData(sheet, UFW_HEADERS, rows.map(ufwRuleToRow), {
    styleCell: styleRtuColumn,
  });
}

export function workbookFromUfwSheets(sheets: UfwExportSheets): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  writeSheet(workbook, UFW_SHEET_GATEWAYS, sheets.gateways);
  writeSheet(workbook, UFW_SHEET_REGISTERED, sheets.registered);
  writeSheet(workbook, UFW_SHEET_UNREGISTERED, sheets.unregistered);
  return workbook;
}

export async function buildUfwExportXlsx(): Promise<UfwExportResult> {
  const [endpoints, gateways] = await Promise.all([
    prisma.phoneEndpoint.findMany({ orderBy: { name: "asc" } }),
    prisma.phoneGateway.findMany({ orderBy: { name: "asc" } }),
  ]);

  const sheets = buildUfwSheets({
    gateways: gateways.map((r) => asStringRecord(r.data)),
    endpoints: endpoints.map((r) => asStringRecord(r.data)),
  });

  const workbook = workbookFromUfwSheets(sheets);
  const buffer = await workbookToBuffer(workbook);
  const filename = `ufw-phones-${formatExportTimestamp()}.xlsx`;
  return { buffer, filename };
}
