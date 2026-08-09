/**
 * Convert parsed RTU XLSX sheets into softswitch import CSV rows.
 */

import { serializeRtuCsv } from "@/modules/phones/rtu-import/csv-serialize";
import type { ParsedRtuWorkbook } from "@/modules/phones/rtu-import/parse-xlsx";
import {
  SHEET_ENDPOINTS,
  SHEET_GATEWAYS,
} from "@/modules/phones/rtu-import/parse-xlsx";
import type {
  RtuConvertIssue,
  RtuConvertResult,
  RtuImportDefaults,
  RtuSourceRow,
} from "@/modules/phones/rtu-import/types";

const PROTO_TO_CODE: Record<string, string> = {
  "H.323": "0",
  SIP: "1",
  SS7: "2",
  Internal: "3",
  "SIP-T/I": "4",
};

/** Set only the first occurrence of a header name. */
function setFirst(
  headers: string[],
  row: string[],
  name: string,
  value: string,
): void {
  const i = headers.indexOf(name);
  if (i >= 0) row[i] = value;
}

/**
 * Duplicate label «Группа балансировки исх. SIP-трафика» appears twice in RTU CSV;
 * setFirst only updates the first — template defaultValues keep the second correct.
 */

function daNetToBit(
  raw: string,
  sheetLabel: string,
  rowNumber: number,
  field: string,
  issues: RtuConvertIssue[],
): string {
  const v = raw.trim();
  if (v === "Да" || v === "1") return "1";
  if (v === "Нет" || v === "0") return "0";
  if (v === "") {
    issues.push({
      message: `Лист «${sheetLabel}», строка ${rowNumber}: пустое поле «${field}» (ожидается Да или Нет)`,
    });
    return "0";
  }
  issues.push({
    message: `Лист «${sheetLabel}», строка ${rowNumber}: поле «${field}» = «${v}» (ожидается Да или Нет)`,
  });
  return "0";
}

function emptyAsNull(value: string): string {
  return value.trim() === "" ? "\\N" : value.trim();
}

function emptyAsEmpty(value: string): string {
  return value.trim();
}

function resolveGroups(
  raw: string,
  groupIdByName: Map<string, string>,
  sheetLabel: string,
  rowNumber: number,
  issues: RtuConvertIssue[],
): string {
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const ids: string[] = [];
  for (const name of parts) {
    const id = groupIdByName.get(name);
    if (!id) {
      issues.push({
        message: `Лист «${sheetLabel}», строка ${rowNumber}: входящая группа «${name}» не найдена в листе «Группы»`,
      });
      continue;
    }
    ids.push(id);
  }
  return ids.join(";");
}

function baseRow(defaults: RtuImportDefaults): string[] {
  return defaults.defaultValues.map((v) => v);
}

function mapEndpoint(
  src: RtuSourceRow,
  defaults: RtuImportDefaults,
  groupIdByName: Map<string, string>,
  issues: RtuConvertIssue[],
): string[] {
  const v = src.values;
  const label = SHEET_ENDPOINTS;
  const headers = defaults.headers;
  const row = baseRow(defaults);
  const set = (name: string, value: string) =>
    setFirst(headers, row, name, value);

  const name = v["Название"]?.trim() ?? "";
  if (!name) {
    issues.push({
      message: `Лист «${label}», строка ${src.rowNumber}: пустое «Название»`,
    });
  }

  set("Запись активна", "1");
  set("Название", name);
  set("Описание", emptyAsEmpty(v["Описание"] ?? ""));
  set("Тип оборудования", "Оконечное оборудование");
  set(
    "Номер оконечного оборудования",
    emptyAsEmpty(v["Номер оконечного оборудования"] ?? ""),
  );
  set(
    "Действует как иниц. устр-во",
    daNetToBit(
      v["Инициирующее устройство"] ?? "",
      label,
      src.rowNumber,
      "Инициирующее устройство",
      issues,
    ),
  );
  set(
    "Действует как терм. устр-во",
    daNetToBit(
      v["Терминирующее устройство"] ?? "",
      label,
      src.rowNumber,
      "Терминирующее устройство",
      issues,
    ),
  );
  set("Протокол сигнализации", "1");
  set(
    "Регистрировать оборудование",
    daNetToBit(
      v["Регистрация"] ?? "",
      label,
      src.rowNumber,
      "Регистрация",
      issues,
    ),
  );
  set("Зона", emptyAsEmpty(v["Зона"] ?? ""));
  set(
    "ИНИЦ. Список адресов (IPv4)",
    emptyAsEmpty(v["ИНИЦ. список адресов"] ?? ""),
  );
  set("ИНИЦ. Порт", emptyAsNull(v["ИНИЦ. порт"] ?? ""));
  set("ИНИЦ. Зона", emptyAsEmpty(v["ИНИЦ. зона"] ?? ""));
  set("ИНИЦ. Ёмкость", emptyAsNull(v["ИНИЦ. емкость"] ?? ""));
  set(
    "Входящие группы",
    resolveGroups(
      v["Входящие группы"] ?? "",
      groupIdByName,
      label,
      src.rowNumber,
      issues,
    ),
  );
  set(
    "ТЕРМ. Список Адресов (IPv4)",
    emptyAsNull(v["ТЕРМ. список адресов"] ?? ""),
  );
  set("ТЕРМ. SIP порт", emptyAsNull(v["ТЕРМ. порт"] ?? ""));
  set("ТЕРМ. Зона", emptyAsEmpty(v["ТЕРМ. зона"] ?? ""));
  set("ТЕРМ. Ёмкость", emptyAsNull(v["ТЕРМ. емкость"] ?? ""));
  set("Регистрационное имя", emptyAsNull(v["Регистрационное имя"] ?? ""));
  set(
    "Регистрационный пароль",
    emptyAsNull(v["Регистрационный пароль"] ?? ""),
  );
  set(
    "Список разреш. адресов для регистрации (IPv4)",
    emptyAsNull(v["Список разрешенных адресов для регистрации"] ?? ""),
  );

  return row;
}

function mapGateway(
  src: RtuSourceRow,
  defaults: RtuImportDefaults,
  groupIdByName: Map<string, string>,
  issues: RtuConvertIssue[],
): string[] {
  const v = src.values;
  const label = SHEET_GATEWAYS;
  const headers = defaults.headers;
  const row = baseRow(defaults);
  const set = (name: string, value: string) =>
    setFirst(headers, row, name, value);

  const name = v["Название"]?.trim() ?? "";
  if (!name) {
    issues.push({
      message: `Лист «${label}», строка ${src.rowNumber}: пустое «Название»`,
    });
  }

  const protoRaw = (v["Протокол сигнализации"] ?? "").trim();
  const protoCode = PROTO_TO_CODE[protoRaw];
  if (!protoCode) {
    issues.push({
      message: `Лист «${label}», строка ${src.rowNumber}: неизвестный «Протокол сигнализации» = «${protoRaw || "(пусто)"}»`,
    });
  }

  set("Запись активна", "1");
  set("Название", name);
  set("Описание", emptyAsEmpty(v["Описание"] ?? ""));
  set("Тип оборудования", "Шлюз");
  set("Номер оконечного оборудования", "");
  set(
    "Действует как иниц. устр-во",
    daNetToBit(
      v["Инициирующее устройство"] ?? "",
      label,
      src.rowNumber,
      "Инициирующее устройство",
      issues,
    ),
  );
  set(
    "Действует как терм. устр-во",
    daNetToBit(
      v["Терминирующее устройство"] ?? "",
      label,
      src.rowNumber,
      "Терминирующее устройство",
      issues,
    ),
  );
  set("Протокол сигнализации", protoCode ?? "1");
  set("Регистрировать оборудование", "0");
  set("Зона", emptyAsEmpty(v["ИНИЦ. зона"] ?? ""));
  set(
    "ИНИЦ. Список адресов (IPv4)",
    emptyAsEmpty(v["ИНИЦ. список адресов"] ?? ""),
  );
  set("ИНИЦ. Порт", emptyAsNull(v["ИНИЦ. порт"] ?? ""));
  set("ИНИЦ. Зона", emptyAsEmpty(v["ИНИЦ. зона"] ?? ""));
  set("ИНИЦ. Ёмкость", emptyAsNull(v["ИНИЦ. емкость"] ?? ""));
  set(
    "Входящие группы",
    resolveGroups(
      v["Входящие группы"] ?? "",
      groupIdByName,
      label,
      src.rowNumber,
      issues,
    ),
  );
  const termAddr = (v["ТЕРМ. список адресов"] ?? "").trim();
  set("ТЕРМ. Список Адресов (IPv4)", termAddr === "" ? "\\N" : termAddr);
  set("ТЕРМ. SIP порт", emptyAsNull(v["ТЕРМ. порт"] ?? ""));
  set("ТЕРМ. Зона", emptyAsEmpty(v["ТЕРМ. зона"] ?? ""));
  set("ТЕРМ. Ёмкость", emptyAsNull(v["ТЕРМ. емкость"] ?? ""));
  set("Регистрационное имя", "\\N");
  set("Регистрационный пароль", "\\N");
  set("Список разреш. адресов для регистрации (IPv4)", "\\N");

  return row;
}

/**
 * Build CSV from a parsed workbook + static column defaults.
 * Collects all validation issues; returns failure if any.
 */
export function convertParsedToRtuCsv(
  parsed: ParsedRtuWorkbook,
  defaults: RtuImportDefaults,
): RtuConvertResult {
  const issues: RtuConvertIssue[] = [...parsed.issues];

  if (
    !defaults.headers?.length ||
    defaults.headers.length !== defaults.defaultValues?.length
  ) {
    return {
      ok: false,
      error: "Не загружен шаблон колонок CSV",
      details: ["Внутренняя ошибка: некорректный rtu-import-defaults.json"],
    };
  }

  const rows: string[][] = [];
  for (const ep of parsed.endpoints) {
    rows.push(mapEndpoint(ep, defaults, parsed.groupIdByName, issues));
  }
  for (const gw of parsed.gateways) {
    rows.push(mapGateway(gw, defaults, parsed.groupIdByName, issues));
  }

  if (issues.length > 0) {
    return {
      ok: false,
      error: "Файл XLSX не подходит для импорта в РТУ",
      details: issues.map((i) => i.message),
    };
  }

  return {
    ok: true,
    csv: serializeRtuCsv(defaults.headers, rows),
    endpointCount: parsed.endpoints.length,
    gatewayCount: parsed.gateways.length,
  };
}
