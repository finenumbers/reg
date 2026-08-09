/**
 * Ephemeral XLSX → RTU import CSV (in-memory only).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadGroupIdByNameMap } from "@/modules/groups/service";
import { convertParsedToRtuCsv } from "@/modules/phones/rtu-import/convert";
import { parseRtuXlsx } from "@/modules/phones/rtu-import/parse-xlsx";
import type {
  RtuConvertResult,
  RtuImportDefaults,
} from "@/modules/phones/rtu-import/types";

let cachedDefaults: RtuImportDefaults | null = null;

function loadRtuImportDefaults(
  cwd: string = process.cwd(),
): RtuImportDefaults {
  if (cachedDefaults) return cachedDefaults;
  const filePath = path.join(cwd, "ops/templates/rtu-import-defaults.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as RtuImportDefaults;
  if (
    !Array.isArray(raw.headers) ||
    !Array.isArray(raw.defaultValues) ||
    raw.headers.length !== raw.defaultValues.length
  ) {
    throw new Error("Invalid rtu-import-defaults.json");
  }
  cachedDefaults = raw;
  return raw;
}

/** Test helper — clear defaults cache. */
export function resetRtuImportDefaultsCache(): void {
  cachedDefaults = null;
}

export type ConvertRtuXlsxOptions = {
  /** Override DB catalog (tests). When omitted, loads routing_groups. */
  groupIdByName?: Map<string, string>;
};

export async function convertRtuXlsxToCsv(
  data: ArrayBuffer | Buffer | Uint8Array,
  defaults?: RtuImportDefaults,
  options?: ConvertRtuXlsxOptions,
): Promise<RtuConvertResult> {
  if (!data || (data as ArrayBuffer).byteLength === 0) {
    return {
      ok: false,
      error: "Файл XLSX не подходит для импорта в РТУ",
      details: ["Загружен пустой файл"],
    };
  }

  const parsed = await parseRtuXlsx(data);
  const tpl = defaults ?? loadRtuImportDefaults();
  const groupIdByName =
    options?.groupIdByName ?? (await loadGroupIdByNameMap());

  if (groupIdByName.size === 0) {
    return {
      ok: false,
      error: "Файл XLSX не подходит для импорта в РТУ",
      details: [
        "Справочник входящих групп пуст — сначала загрузите данные в разделе «Входящие группы»",
      ],
    };
  }

  return convertParsedToRtuCsv(
    { ...parsed, groupIdByName },
    tpl,
  );
}

export type { RtuConvertResult } from "@/modules/phones/rtu-import/types";
