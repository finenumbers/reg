/**
 * Read the current registration pages from the RTU SOAP API.
 * A summary page is one selectRowset without a node header.
 * The shared template is one selectRowset per signaling or scripting module.
 * getLookup is only for «Состояние» and never carries a node header.
 * When the WSDL omits both lookup operations, one handbook getLookup is sent.
 * A missing or unread list leaves the cell as it arrived.
 * An unrecognized state still fails the job after the rows are read.
 */

import {
  ACTIVE_MODULES_TITLE,
  findActiveModules,
  mapColumns,
} from "@/modules/live-calls/catalog";
import { selectRegistrationModules } from "@/modules/live-calls/modules";
import { MAX_CALL_PAGES, conferenceIdSet, decideNextPage } from "@/modules/live-calls/pages";
import {
  findRegistrationTable,
  type RegistrationObject,
  type RegistrationTableHit,
  PCOMM_REGISTRATIONS_TITLE,
  PUPR_REGISTRATIONS_TITLE,
  REGISTRATION_ADDRESS_TITLE,
  REGISTRATION_AGENT_TITLE,
  REGISTRATION_ALIASES_TITLE,
  REGISTRATION_ID_TITLE,
  REGISTRATION_NAME_TITLE,
  REGISTRATION_STATE_TITLE,
} from "@/modules/registrations/rtu-catalog";
import type { PcommRegistration, PuprRegistration } from "@/modules/registrations/rtu-rows";
import { loadRtuSoapAccount } from "@/modules/rtu-soap/credentials";
import { rtuExchange, type RtuExchange } from "@/modules/rtu-soap/exchange";
import {
  SELECT_ROW_LIMIT,
  buildDescribeTableEnvelope,
  buildGetLookupEnvelope,
  buildGetObjectsEnvelope,
  buildSelectRowsetEnvelope,
  registrationStateLookup,
  isRtuColumnName,
  quoteSoapAction,
} from "@/modules/rtu-soap/envelope";
import {
  interpretDescribeTable,
  interpretGetLookup,
  interpretGetObjects,
  interpretSelectRowset,
} from "@/modules/rtu-soap/response";
import { readCallReads, readWsdl, type CallReadPlan } from "@/modules/rtu-soap/wsdl";

const WSDL_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 12_000;
const MODULE_COLUMN = "Модуль";
const MODULES_TRUNCATED = "Список активных модулей прочитан не целиком.";

export type RegistrationsAccount = {
  origin: string;
  login: string;
  password: string;
  caPem: string | null;
};

export type RegistrationsRead =
  | { ok: true; pcomm: PcommRegistration[]; pupr: PuprRegistration[] }
  | { ok: false; detail: string };

export type RegistrationsExchange = (input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  caPem: string | null;
  fetchImpl?: typeof fetch;
}) => Promise<RtuExchange>;

export async function readStoredRegistrations(
  fetchImpl?: typeof fetch,
): Promise<RegistrationsRead> {
  const account = await loadRtuSoapAccount();
  if (!account.ok) {
    return {
      ok: false,
      detail:
        account.code === "DECRYPT_FAILED"
          ? "Пароль API РТУ не расшифрован."
          : "Учётка API РТУ не задана.",
    };
  }
  return readRegistrations({ account, fetchImpl });
}

export async function readRegistrations(deps: {
  account: RegistrationsAccount;
  fetchImpl?: typeof fetch;
  exchange?: RegistrationsExchange;
}): Promise<RegistrationsRead> {
  const exchange = deps.exchange ?? rtuExchange;
  const wsdl = await exchange({
    url: `${deps.account.origin}/service/?wsdl_v2`,
    method: "GET",
    headers: { Accept: "text/xml, application/xml" },
    timeoutMs: WSDL_TIMEOUT_MS,
    caPem: deps.account.caPem,
    fetchImpl: deps.fetchImpl,
  });
  if (!wsdl.ok) return { ok: false, detail: wsdl.detail };
  if (wsdl.status >= 300 && wsdl.status < 400) {
    return { ok: false, detail: "WSDL ответил редиректом. Пароль не отправлен." };
  }
  if (wsdl.status < 200 || wsdl.status >= 300) {
    return { ok: false, detail: "WSDL не получен." };
  }
  const objectsPlan = readWsdl(wsdl.text, deps.account.origin);
  const readsPlan = readCallReads(wsdl.text, deps.account.origin);
  if (!objectsPlan.ok || !readsPlan.ok || objectsPlan.endpoint !== readsPlan.endpoint) {
    const reason = !objectsPlan.ok
      ? objectsPlan.reason
      : !readsPlan.ok
        ? readsPlan.reason
        : "host";
    return {
      ok: false,
      detail:
        reason === "host"
          ? "WSDL указывает другой адрес. Пароль не отправлен."
          : "Схема чтения РТУ в WSDL не разобрана.",
    };
  }

  const listed = await postRead(
    deps,
    exchange,
    objectsPlan.endpoint,
    objectsPlan.binding.soapAction,
    buildGetObjectsEnvelope(objectsPlan.binding, deps.account.login, deps.account.password),
  );
  if (!listed.ok) return listed;
  const objects = interpretGetObjects(listed.text, deps.account.password);
  if (objects.kind === "fault") return { ok: false, detail: objects.detail };
  if (objects.kind !== "objects") {
    return { ok: false, detail: "Ответ getObjects не разобран." };
  }
  const pcommTable = findRegistrationTable(objects.objects, PCOMM_REGISTRATIONS_TITLE);
  if (!pcommTable.ok) return pcommTable;
  const puprTable = findRegistrationTable(objects.objects, PUPR_REGISTRATIONS_TITLE);
  if (!puprTable.ok) return puprTable;

  const reads = readsPlan;
  const pcommColumns = await describeColumns(
    deps,
    exchange,
    reads,
    pcommTable.objectId,
    PCOMM_REGISTRATIONS_TITLE,
    {
      id: REGISTRATION_ID_TITLE,
      name: REGISTRATION_NAME_TITLE,
      aliases: REGISTRATION_ALIASES_TITLE,
      address: REGISTRATION_ADDRESS_TITLE,
      state: REGISTRATION_STATE_TITLE,
    },
  );
  if (!pcommColumns.ok) return pcommColumns;
  const puprColumns = await describeColumns(
    deps,
    exchange,
    reads,
    puprTable.objectId,
    PUPR_REGISTRATIONS_TITLE,
    {
      id: REGISTRATION_ID_TITLE,
      agent: REGISTRATION_AGENT_TITLE,
    },
  );
  if (!puprColumns.ok) return puprColumns;

  if (pcommColumns.columns.id.haveLookup || pcommColumns.columns.name.haveLookup || pcommColumns.columns.aliases.haveLookup || pcommColumns.columns.address.haveLookup) {
    const titled = pcommColumns.columns.id.haveLookup
      ? REGISTRATION_ID_TITLE
      : pcommColumns.columns.name.haveLookup
        ? REGISTRATION_NAME_TITLE
        : pcommColumns.columns.aliases.haveLookup
          ? REGISTRATION_ALIASES_TITLE
          : REGISTRATION_ADDRESS_TITLE;
    return { ok: false, detail: `Колонка «${titled}» имеет список подстановки.` };
  }
  if (puprColumns.columns.id.haveLookup || puprColumns.columns.agent.haveLookup) {
    return {
      ok: false,
      detail: `Колонка «${puprColumns.columns.agent.haveLookup ? REGISTRATION_AGENT_TITLE : REGISTRATION_ID_TITLE}» имеет список подстановки.`,
    };
  }

  const labels = await stateLabels(
    deps,
    exchange,
    reads,
    pcommTable.objectId,
    pcommColumns.columns.state,
  );
  if (!labels.ok) return labels;

  const pcommNames = [
    pcommColumns.columns.id.name,
    pcommColumns.columns.name.name,
    pcommColumns.columns.aliases.name,
    pcommColumns.columns.address.name,
    pcommColumns.columns.state.name,
  ];
  const puprNames = [puprColumns.columns.id.name, puprColumns.columns.agent.name];
  if ([...pcommNames, ...puprNames].some((name) => !isRtuColumnName(name))) {
    return { ok: false, detail: "Колонка РТУ имеет неподдерживаемое имя." };
  }

  const named = await loadRegistrationModules(
    deps,
    exchange,
    reads,
    objects.objects,
    {
      signaling: pcommTable.source === "template",
      scripting: puprTable.source === "template",
    },
  );
  if (!named.ok) return named;

  const pcommPages = await readSide(
    deps,
    exchange,
    reads,
    pcommTable,
    pcommNames,
    pcommColumns.columns.id.name,
    named.signaling,
  );
  if (!pcommPages.ok) return pcommPages;
  const puprPages = await readSide(
    deps,
    exchange,
    reads,
    puprTable,
    puprNames,
    puprColumns.columns.id.name,
    named.scripting,
  );
  if (!puprPages.ok) return puprPages;

  const pcomm: PcommRegistration[] = [];
  for (const row of pcommPages.rows) {
    pcomm.push({
      id: row[pcommColumns.columns.id.name] ?? "",
      name: row[pcommColumns.columns.name.name] ?? "",
      aliases: row[pcommColumns.columns.aliases.name] ?? "",
      address: row[pcommColumns.columns.address.name] ?? "",
      state: presentState(row[pcommColumns.columns.state.name] ?? "", labels.labels),
    });
  }
  const pupr = puprPages.rows.map((row) => ({
    id: row[puprColumns.columns.id.name] ?? "",
    userAgent: row[puprColumns.columns.agent.name] ?? "",
  }));
  return { ok: true, pcomm, pupr };
}

type Mapped<Key extends string> = {
  ok: true;
  columns: Record<Key, { name: string; dataMask: string | null; haveLookup: boolean }>;
};

async function describeColumns<Key extends string>(
  deps: { account: RegistrationsAccount; fetchImpl?: typeof fetch },
  exchange: RegistrationsExchange,
  reads: Extract<CallReadPlan, { ok: true }>,
  objectId: string,
  tableTitle: string,
  titles: Record<Key, string>,
): Promise<Mapped<Key> | { ok: false; detail: string }> {
  let envelope: string;
  try {
    envelope = buildDescribeTableEnvelope(
      reads.describeTable,
      deps.account.login,
      deps.account.password,
      objectId,
    );
  } catch {
    return { ok: false, detail: "Идентификатор таблицы РТУ не подходит для чтения." };
  }
  const described = await postRead(
    deps,
    exchange,
    reads.endpoint,
    reads.describeTable.soapAction,
    envelope,
  );
  if (!described.ok) return described;
  const columns = interpretDescribeTable(described.text, deps.account.password);
  if (columns.kind === "fault") return { ok: false, detail: columns.detail };
  if (columns.kind !== "columns") {
    return { ok: false, detail: "Ответ describeTable не разобран." };
  }
  const mapped = mapColumns(columns.columns, titles, tableTitle);
  if (!mapped.ok) return mapped;
  return { ok: true, columns: mapped.columns };
}

async function stateLabels(
  deps: { account: RegistrationsAccount; fetchImpl?: typeof fetch },
  exchange: RegistrationsExchange,
  reads: Extract<CallReadPlan, { ok: true }>,
  objectId: string,
  column: { name: string; haveLookup: boolean },
): Promise<{ ok: true; labels: ReadonlyMap<string, string> | null } | { ok: false; detail: string }> {
  if (!column.haveLookup) return { ok: true, labels: null };
  const binding = reads.getLookup ?? registrationStateLookup(reads.describeTable);
  if (!binding) return { ok: true, labels: null };
  if (!isRtuColumnName(column.name)) {
    return { ok: false, detail: "Колонка РТУ имеет неподдерживаемое имя." };
  }
  let envelope: string;
  try {
    envelope = buildGetLookupEnvelope(
      binding,
      deps.account.login,
      deps.account.password,
      objectId,
      column.name,
    );
  } catch {
    return { ok: true, labels: null };
  }
  const posted = await postRead(
    deps,
    exchange,
    reads.endpoint,
    binding.soapAction,
    envelope,
  );
  if (!posted.ok) return { ok: true, labels: null };
  const parsed = interpretGetLookup(posted.text, deps.account.password);
  if (parsed.kind !== "lookup") return { ok: true, labels: null };
  const labels = new Map<string, string>();
  for (const pair of parsed.pairs) labels.set(pair.key, pair.value);
  return { ok: true, labels };
}

function presentState(raw: string, labels: ReadonlyMap<string, string> | null): string {
  if (labels) {
    const mapped = labels.get(raw.trim());
    if (mapped !== undefined) return mapped;
  }
  return raw;
}

async function loadRegistrationModules(
  deps: { account: RegistrationsAccount; fetchImpl?: typeof fetch },
  exchange: RegistrationsExchange,
  reads: Extract<CallReadPlan, { ok: true }>,
  objects: readonly RegistrationObject[],
  need: { signaling: boolean; scripting: boolean },
): Promise<
  { ok: true; signaling: string[]; scripting: string[] } | { ok: false; detail: string }
> {
  if (!need.signaling && !need.scripting) {
    return { ok: true, signaling: [], scripting: [] };
  }
  const found = findActiveModules(objects);
  if (!found.ok) {
    return {
      ok: false,
      detail:
        found.reason === "many"
          ? `Каталог РТУ: несколько страниц «${ACTIVE_MODULES_TITLE}».`
          : `Каталог РТУ: нет страницы «${ACTIVE_MODULES_TITLE}».`,
    };
  }
  const described = await describeColumns(
    deps,
    exchange,
    reads,
    found.objectId,
    ACTIVE_MODULES_TITLE,
    { module: MODULE_COLUMN },
  );
  if (!described.ok) return described;
  if (described.columns.module.haveLookup) {
    return { ok: false, detail: `Колонка «${MODULE_COLUMN}» имеет список подстановки.` };
  }
  if (!isRtuColumnName(described.columns.module.name)) {
    return { ok: false, detail: "Колонка РТУ имеет неподдерживаемое имя." };
  }
  const pages = await readPages(
    deps,
    exchange,
    reads,
    found.objectId,
    [described.columns.module.name],
    described.columns.module.name,
    undefined,
    MODULES_TRUNCATED,
  );
  if (!pages.ok) return pages;
  return selectRegistrationModules(
    pages.rows.map((row) => row[described.columns.module.name] ?? ""),
    need,
  );
}

async function readSide(
  deps: { account: RegistrationsAccount; fetchImpl?: typeof fetch },
  exchange: RegistrationsExchange,
  reads: Extract<CallReadPlan, { ok: true }>,
  table: RegistrationTableHit,
  columns: string[],
  idColumn: string,
  moduleNames: readonly string[],
): Promise<{ ok: true; rows: Array<Record<string, string>> } | { ok: false; detail: string }> {
  if (table.source === "summary") {
    return readPages(deps, exchange, reads, table.objectId, columns, idColumn);
  }
  const rows: Array<Record<string, string>> = [];
  for (const moduleName of moduleNames) {
    const page = await readPages(
      deps,
      exchange,
      reads,
      table.objectId,
      columns,
      idColumn,
      moduleName,
    );
    if (!page.ok) return page;
    rows.push(...page.rows);
  }
  return { ok: true, rows };
}

async function readPages(
  deps: { account: RegistrationsAccount; fetchImpl?: typeof fetch },
  exchange: RegistrationsExchange,
  reads: Extract<CallReadPlan, { ok: true }>,
  objectId: string,
  columns: string[],
  idColumn: string,
  moduleName?: string,
  truncatedDetail?: string,
): Promise<{ ok: true; rows: Array<Record<string, string>> } | { ok: false; detail: string }> {
  return collectRegistrationPages(async (offset) => {
    let envelope: string;
    try {
      envelope = buildSelectRowsetEnvelope(
        reads.selectRowset,
        deps.account.login,
        deps.account.password,
        objectId,
        columns,
        moduleName,
        offset,
      );
    } catch {
      return { ok: false, detail: "Страница списка регистраций не собрана." };
    }
    const selected = await postRead(
      deps,
      exchange,
      reads.endpoint,
      reads.selectRowset.soapAction,
      envelope,
    );
    if (!selected.ok) return selected;
    const parsed = interpretSelectRowset(selected.text, deps.account.password);
    if (parsed.kind === "fault") return { ok: false, detail: parsed.detail };
    if (parsed.kind !== "rows") {
      return { ok: false, detail: "Ответ selectRowset не разобран." };
    }
    return { ok: true, rows: parsed.rows };
  }, idColumn, truncatedDetail);
}

export async function collectRegistrationPages(
  readPage: (
    offset: number,
  ) => Promise<
    { ok: true; rows: Array<Record<string, string>> } | { ok: false; detail: string }
  >,
  idColumn: string,
  truncatedDetail = "Список регистраций прочитан не целиком.",
): Promise<
  { ok: true; rows: Array<Record<string, string>> } | { ok: false; detail: string }
> {
  const rows: Array<Record<string, string>> = [];
  let previousIds: Set<string> | null = null;
  for (let page = 0; page < MAX_CALL_PAGES; page += 1) {
    const selected = await readPage(page * SELECT_ROW_LIMIT);
    if (!selected.ok) return selected;
    const pageIds = conferenceIdSet(selected.rows, idColumn);
    const decision = decideNextPage({
      pageIndex: page,
      rowCount: selected.rows.length,
      pageIds,
      previousIds,
      pageSize: SELECT_ROW_LIMIT,
      maxPages: MAX_CALL_PAGES,
    });
    if (decision.append) rows.push(...selected.rows);
    if (decision.truncated) {
      return { ok: false, detail: truncatedDetail };
    }
    if (decision.action === "stop") break;
    previousIds = pageIds;
  }
  return { ok: true, rows };
}

async function postRead(
  deps: { account: RegistrationsAccount; fetchImpl?: typeof fetch },
  exchange: RegistrationsExchange,
  endpoint: string,
  soapAction: string,
  envelope: string,
): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  const posted = await exchange({
    url: endpoint,
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: quoteSoapAction(soapAction),
    },
    body: envelope,
    timeoutMs: READ_TIMEOUT_MS,
    caPem: deps.account.caPem,
    fetchImpl: deps.fetchImpl,
  });
  if (!posted.ok) return { ok: false, detail: posted.detail };
  if (posted.status >= 300 && posted.status < 400) {
    return { ok: false, detail: "Сервис ответил редиректом." };
  }
  if (posted.status < 200 || posted.status >= 300) {
    return { ok: false, detail: "Коммутатор ответил ошибкой HTTP." };
  }
  return { ok: true, text: posted.text };
}
