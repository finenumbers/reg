/**
 * Read the current «Входящие группы» rows from the RTU SOAP API.
 * getObjects, describeTable, and selectRowset only. No node header.
 */

import { mapColumns } from "@/modules/live-calls/catalog";
import { MAX_CALL_PAGES, conferenceIdSet, decideNextPage } from "@/modules/live-calls/pages";
import {
  acceptIncomingGroups,
  findIncomingGroupsTable,
  INCOMING_GROUP_ID_TITLE,
  INCOMING_GROUP_NAME_TITLE,
  INCOMING_GROUPS_TITLE,
} from "@/modules/groups/rtu-catalog";
import type { ParsedRoutingGroup } from "@/modules/groups/parse";
import { loadRtuSoapAccount } from "@/modules/rtu-soap/credentials";
import { rtuExchange, type RtuExchange } from "@/modules/rtu-soap/exchange";
import {
  SELECT_ROW_LIMIT,
  buildDescribeTableEnvelope,
  buildGetObjectsEnvelope,
  buildSelectRowsetEnvelope,
  isRtuColumnName,
  quoteSoapAction,
} from "@/modules/rtu-soap/envelope";
import {
  interpretDescribeTable,
  interpretGetObjects,
  interpretSelectRowset,
} from "@/modules/rtu-soap/response";
import { readCallReads, readWsdl } from "@/modules/rtu-soap/wsdl";

const WSDL_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 12_000;

export type IncomingGroupsAccount = {
  origin: string;
  login: string;
  password: string;
  caPem: string | null;
};

export type IncomingGroupsRead =
  | { ok: true; groups: ParsedRoutingGroup[] }
  | { ok: false; detail: string };

export type IncomingGroupsExchange = (input: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  caPem: string | null;
  fetchImpl?: typeof fetch;
}) => Promise<RtuExchange>;

export async function readStoredIncomingGroups(
  fetchImpl?: typeof fetch,
): Promise<IncomingGroupsRead> {
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
  return readIncomingGroups({ account, fetchImpl });
}

export async function readIncomingGroups(deps: {
  account: IncomingGroupsAccount;
  fetchImpl?: typeof fetch;
  exchange?: IncomingGroupsExchange;
}): Promise<IncomingGroupsRead> {
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
    buildGetObjectsEnvelope(
      objectsPlan.binding,
      deps.account.login,
      deps.account.password,
    ),
  );
  if (!listed.ok) return listed;
  const objects = interpretGetObjects(listed.text, deps.account.password);
  if (objects.kind === "fault") return { ok: false, detail: objects.detail };
  if (objects.kind !== "objects") {
    return { ok: false, detail: "Ответ getObjects не разобран." };
  }
  const table = findIncomingGroupsTable(objects.objects);
  if (!table.ok) return table;

  let describeEnvelope: string;
  try {
    describeEnvelope = buildDescribeTableEnvelope(
      readsPlan.describeTable,
      deps.account.login,
      deps.account.password,
      table.objectId,
    );
  } catch {
    return { ok: false, detail: "Идентификатор таблицы РТУ не подходит для чтения." };
  }
  const described = await postRead(
    deps,
    exchange,
    readsPlan.endpoint,
    readsPlan.describeTable.soapAction,
    describeEnvelope,
  );
  if (!described.ok) return described;
  const columns = interpretDescribeTable(described.text, deps.account.password);
  if (columns.kind === "fault") return { ok: false, detail: columns.detail };
  if (columns.kind !== "columns") {
    return { ok: false, detail: "Ответ describeTable не разобран." };
  }
  const mapped = mapColumns(
    columns.columns,
    { id: INCOMING_GROUP_ID_TITLE, name: INCOMING_GROUP_NAME_TITLE },
    INCOMING_GROUPS_TITLE,
  );
  if (!mapped.ok) return mapped;
  if (mapped.columns.id.haveLookup) {
    return { ok: false, detail: `Колонка «${INCOMING_GROUP_ID_TITLE}» имеет список подстановки.` };
  }
  if (mapped.columns.name.haveLookup) {
    return {
      ok: false,
      detail: `Колонка «${INCOMING_GROUP_NAME_TITLE}» имеет список подстановки.`,
    };
  }
  const idColumn = mapped.columns.id.name;
  const nameColumn = mapped.columns.name.name;
  if (!isRtuColumnName(idColumn) || !isRtuColumnName(nameColumn)) {
    return { ok: false, detail: "Колонка РТУ имеет неподдерживаемое имя." };
  }

  const pages = await collectIncomingGroupPages(async (offset) => {
    let envelope: string;
    try {
      envelope = buildSelectRowsetEnvelope(
        readsPlan.selectRowset,
        deps.account.login,
        deps.account.password,
        table.objectId,
        [idColumn, nameColumn],
        undefined,
        offset,
      );
    } catch {
      return { ok: false, detail: "Страница списка входящих групп не собрана." };
    }
    const selected = await postRead(
      deps,
      exchange,
      readsPlan.endpoint,
      readsPlan.selectRowset.soapAction,
      envelope,
    );
    if (!selected.ok) return selected;
    const parsed = interpretSelectRowset(selected.text, deps.account.password);
    if (parsed.kind === "fault") return { ok: false, detail: parsed.detail };
    if (parsed.kind !== "rows") {
      return { ok: false, detail: "Ответ selectRowset не разобран." };
    }
    return { ok: true, rows: parsed.rows };
  }, idColumn);
  if (!pages.ok) return pages;

  const draft = pages.rows.map((row) => ({
    externalId: row[idColumn] ?? "",
    name: row[nameColumn] ?? "",
  }));
  return acceptIncomingGroups(draft);
}

/**
 * Every page of the current list. A short page ends it.
 * A capped, repeated, or oversized page is not a complete list.
 */
export async function collectIncomingGroupPages(
  readPage: (
    offset: number,
  ) => Promise<
    | { ok: true; rows: Array<Record<string, string>> }
    | { ok: false; detail: string }
  >,
  idColumn: string,
): Promise<
  | { ok: true; rows: Array<Record<string, string>> }
  | { ok: false; detail: string }
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
      return { ok: false, detail: "Список входящих групп прочитан не целиком." };
    }
    if (decision.action === "stop") break;
    previousIds = pageIds;
  }
  return { ok: true, rows };
}

async function postRead(
  deps: { account: IncomingGroupsAccount; fetchImpl?: typeof fetch },
  exchange: IncomingGroupsExchange,
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
