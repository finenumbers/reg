/**
 * Build softswitch-format phones XLSX from local DB + template.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { getDisplayTimezone } from "@/modules/settings";
import {
  formatExportTimestamp,
  replaceSheetData,
  workbookToBuffer,
  XLSX_UNREGISTERED_FILL,
} from "@/lib/xlsx-export";
import { sortRoutingGroupsById } from "@/modules/groups/sort";
import { isSipUnregistered, toUnregisteredPhoneSet } from "@/modules/phones/sip-status";
import {
  ENDPOINT_HEADERS,
  GATEWAY_HEADERS,
  type PhoneRowData,
} from "@/modules/phones/types";

const SHEET_GROUPS = "Группы";
const SHEET_ENDPOINTS = "Оконечное оборудование";
const SHEET_GATEWAYS = "Шлюзы";

function phonesTemplatePath(): string {
  const candidate = path.join(process.cwd(), "ops/templates/phones-export.xlsx");
  if (existsSync(candidate)) return candidate;
  throw new Error(
    "Шаблон экспорта телефонов не найден (ops/templates/phones-export.xlsx)",
  );
}

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

function rowValues(
  headers: readonly string[],
  data: PhoneRowData,
): string[] {
  return headers.map((h) => data[h] ?? "");
}

export type PhonesExportResult = {
  buffer: Buffer;
  filename: string;
};

export async function buildPhonesExportXlsx(): Promise<PhonesExportResult> {
  const [endpoints, gateways, routingGroups, unregisteredRows, timeZone] =
    await Promise.all([
      prisma.phoneEndpoint.findMany({ orderBy: { name: "asc" } }),
      prisma.phoneGateway.findMany({ orderBy: { name: "asc" } }),
      prisma.routingGroup.findMany(),
      prisma.registrationCurrent.findMany({
        where: { status: "Unregistered" },
        select: { phone: true },
      }),
      getDisplayTimezone(),
    ]);

  const routingGroupsSorted = sortRoutingGroupsById(routingGroups);
  const unregisteredSet = toUnregisteredPhoneSet(
    unregisteredRows.map((r) => r.phone),
  );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(phonesTemplatePath());

  const groups = workbook.getWorksheet(SHEET_GROUPS);
  if (!groups) {
    throw new Error(`В шаблоне нет вкладки «${SHEET_GROUPS}»`);
  }

  const epSheet = workbook.getWorksheet(SHEET_ENDPOINTS);
  if (!epSheet) {
    throw new Error(`В шаблоне нет вкладки «${SHEET_ENDPOINTS}»`);
  }

  const gwSheet = workbook.getWorksheet(SHEET_GATEWAYS);
  if (!gwSheet) {
    throw new Error(`В шаблоне нет вкладки «${SHEET_GATEWAYS}»`);
  }

  const epRows = endpoints.map((row) =>
    rowValues(ENDPOINT_HEADERS, asStringRecord(row.data)),
  );
  const epNumbers = endpoints.map((row) => row.endpointNumber);

  replaceSheetData(epSheet, ENDPOINT_HEADERS, epRows, {
    highlightFill: XLSX_UNREGISTERED_FILL,
    highlightRow: (index) =>
      isSipUnregistered(epNumbers[index] ?? null, unregisteredSet),
  });

  const gwRows = gateways.map((row) =>
    rowValues(GATEWAY_HEADERS, asStringRecord(row.data)),
  );
  replaceSheetData(gwSheet, GATEWAY_HEADERS, gwRows);

  const groupHeaders = ["ID", "Название"] as const;
  const groupRows = routingGroupsSorted.map((g) => [g.externalId, g.name]);
  replaceSheetData(groups, groupHeaders, groupRows);

  const buffer = await workbookToBuffer(workbook);
  const filename = `phones-${formatExportTimestamp(new Date(), timeZone)}.xlsx`;
  return { buffer, filename };
}
