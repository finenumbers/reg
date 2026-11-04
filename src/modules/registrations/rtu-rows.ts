/**
 * Turn the two RTU registration pages and the local phone catalog
 * into one row per phone.
 */

import { normalizeRtuLabel } from "@/modules/live-calls/columns";
import type { ParsedRegistrationRow } from "@/modules/registrations/parser";

export const REGISTRATION_NAME_FIELD = "Регистрационное имя";
export const REGISTRATION_FLAG_FIELD = "Регистрация";
export const REGISTRATION_YES = "Да";
const AGENT_MAX = 2000;

export type PcommRegistration = {
  id: string;
  name: string;
  aliases: string;
  state: string;
  address: string;
};

export type PuprRegistration = {
  id: string;
  userAgent: string;
};

export type CatalogRegistrationEndpoint = {
  endpointNumber: string | null;
  registrationName: string;
  registrationFlag: string;
};

export type AssembledRegistrations = {
  rows: ParsedRegistrationRow[];
  pcommCount: number;
};

type LiveRow = {
  phone: string;
  status: "Registered" | "Unregistered";
  ip: string | null;
  port: number | null;
  userAgent: string | null;
};

export function assembleRegistrations(input: {
  pcomm: readonly PcommRegistration[];
  pupr: readonly PuprRegistration[];
  catalog: readonly CatalogRegistrationEndpoint[];
}): { ok: true; value: AssembledRegistrations } | { ok: false; detail: string } {
  if (input.pcomm.length === 0) {
    return { ok: true, value: { rows: [], pcommCount: 0 } };
  }

  const pcomm = collapsePcomm(input.pcomm);
  if (!pcomm.ok) return pcomm;
  const pupr = collapsePupr(input.pupr);
  if (!pupr.ok) return pupr;
  if (input.pupr.length > 0 && !sharesId(pcomm.rows, pupr.byId)) {
    return { ok: false, detail: "Страницы регистраций не соединяются по ID." };
  }

  const catalogIndex = indexCatalog(input.catalog);
  const numbers = endpointNumbers(input.catalog);
  const joined: LiveRow[] = [];
  for (const row of pcomm.rows) {
    const agent = pupr.byId.get(row.id) ?? null;
    const phone = resolvePhone(row.name, row.aliases, catalogIndex, numbers);
    if (!phone.ok) return phone;
    const lived = liveRow(phone.phone, row, agent);
    if (!lived.ok) return lived;
    joined.push(lived.row);
  }

  const collapsed = collapsePhones(joined);
  if (!collapsed.ok) return collapsed;

  const seen = new Set(collapsed.rows.map((row) => row.phone));
  for (const endpoint of input.catalog) {
    const number = endpoint.endpointNumber?.trim() ?? "";
    if (!number || seen.has(number)) continue;
    if (endpoint.registrationFlag.trim() !== REGISTRATION_YES) continue;
    seen.add(number);
    collapsed.rows.push({
      phone: number,
      status: "Unregistered",
      ip: null,
      port: null,
      userAgent: null,
      rawLine: "",
    });
  }

  return {
    ok: true,
    value: { rows: collapsed.rows, pcommCount: input.pcomm.length },
  };
}

function collapsePcomm(
  rows: readonly PcommRegistration[],
): { ok: true; rows: PcommRegistration[] } | { ok: false; detail: string } {
  const byId = new Map<string, string>();
  const kept: PcommRegistration[] = [];
  for (const row of rows) {
    const id = row.id.trim();
    if (!id) return { ok: false, detail: "Пустой ID регистрации." };
    const content = [row.name, row.aliases, row.state, row.address]
      .map((part) => part.trim())
      .join("\n");
    const previous = byId.get(id);
    if (previous == null) {
      byId.set(id, content);
      kept.push({ ...row, id });
      continue;
    }
    if (previous !== content) {
      return { ok: false, detail: "Две разные записи с одним ID регистрации." };
    }
  }
  return { ok: true, rows: kept };
}

function collapsePupr(
  rows: readonly PuprRegistration[],
): { ok: true; byId: Map<string, string | null> } | { ok: false; detail: string } {
  const byId = new Map<string, string | null>();
  for (const row of rows) {
    const id = row.id.trim();
    if (!id) return { ok: false, detail: "Пустой ID регистрации." };
    const agent = cleanAgent(row.userAgent);
    if (!agent.ok) return agent;
    const previous = byId.get(id);
    if (previous === undefined) {
      byId.set(id, agent.value);
      continue;
    }
    if (previous !== agent.value) {
      return { ok: false, detail: "Два разных агента у одного ID регистрации." };
    }
  }
  return { ok: true, byId };
}

function sharesId(
  pcomm: readonly PcommRegistration[],
  pupr: ReadonlyMap<string, string | null>,
): boolean {
  for (const row of pcomm) {
    if (pupr.has(row.id)) return true;
  }
  return false;
}

function indexCatalog(rows: readonly CatalogRegistrationEndpoint[]): Map<string, Set<string>> {
  const byName = new Map<string, Set<string>>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim() ?? "";
    const name = row.registrationName.trim();
    if (!number || !name) continue;
    const set = byName.get(name) ?? new Set<string>();
    set.add(number);
    byName.set(name, set);
  }
  return byName;
}

function endpointNumbers(rows: readonly CatalogRegistrationEndpoint[]): Set<string> {
  const numbers = new Set<string>();
  for (const row of rows) {
    const number = row.endpointNumber?.trim() ?? "";
    if (number) numbers.add(number);
  }
  return numbers;
}

function resolvePhone(
  name: string,
  aliases: string,
  byName: ReadonlyMap<string, Set<string>>,
  numbers: ReadonlySet<string>,
): { ok: true; phone: string } | { ok: false; detail: string } {
  const named = matchToken(name.trim(), byName, numbers);
  if (named === "conflict") {
    return { ok: false, detail: "Две записи оборудования с одним регистрационным именем." };
  }
  if (named) return { ok: true, phone: named };
  const alias = aliases.trim();
  if (alias && !/[\s,;]/.test(alias)) {
    const matched = matchToken(alias, byName, numbers);
    if (matched === "conflict") {
      return { ok: false, detail: "Две записи оборудования с одним регистрационным именем." };
    }
    if (matched) return { ok: true, phone: matched };
  }
  return {
    ok: false,
    detail: `Не удалось сопоставить телефон для регистрации «${clip(name)}».`,
  };
}

function matchToken(
  token: string,
  byName: ReadonlyMap<string, Set<string>>,
  numbers: ReadonlySet<string>,
): string | "conflict" | null {
  if (!token) return null;
  const named = byName.get(token);
  if (named) {
    if (named.size > 1) return "conflict";
    const phone = [...named][0];
    return phone ?? null;
  }
  if (numbers.has(token)) return token;
  if (/^\d+$/.test(token)) return token;
  return null;
}

function liveRow(
  phone: string,
  row: PcommRegistration,
  agent: string | null,
): { ok: true; row: LiveRow } | { ok: false; detail: string } {
  const state = normalizeRtuLabel(row.state);
  if (state === "Зарегистрирован" || state === "Перерегистрация") {
    const address = parseAddress(row.address);
    if (!address.ok) {
      const raw = row.address.trim();
      return {
        ok: false,
        detail: raw
          ? `Адрес «${clip(raw)}» не является IPv4.`
          : `У зарегистрированного «${clip(row.name)}» нет адреса.`,
      };
    }
    return {
      ok: true,
      row: {
        phone,
        status: "Registered",
        ip: address.ip,
        port: address.port,
        userAgent: agent,
      },
    };
  }
  if (state === "Не зарегистрирован" || state === "Инициализация") {
    return {
      ok: true,
      row: { phone, status: "Unregistered", ip: null, port: null, userAgent: null },
    };
  }
  return { ok: false, detail: `Состояние «${clip(state || row.state)}» не разобрано.` };
}

function collapsePhones(
  rows: readonly LiveRow[],
): { ok: true; rows: ParsedRegistrationRow[] } | { ok: false; detail: string } {
  const byPhone = new Map<string, LiveRow[]>();
  for (const row of rows) {
    const list = byPhone.get(row.phone) ?? [];
    list.push(row);
    byPhone.set(row.phone, list);
  }
  const result: ParsedRegistrationRow[] = [];
  for (const [phone, list] of byPhone) {
    const live = list.filter((row) => row.status === "Registered");
    if (live.length === 0) {
      result.push({
        phone,
        status: "Unregistered",
        ip: null,
        port: null,
        userAgent: null,
        rawLine: "",
      });
      continue;
    }
    const first = live[0]!;
    const key = signature(first);
    if (live.some((row) => signature(row) !== key)) {
      return { ok: false, detail: `У номера «${clip(phone)}» несколько разных регистраций.` };
    }
    result.push({ ...first, rawLine: "" });
  }
  return { ok: true, rows: result };
}

function signature(row: LiveRow): string {
  return `${row.ip ?? ""}\n${row.port ?? ""}\n${row.userAgent ?? ""}`;
}

function cleanAgent(
  value: string,
): { ok: true; value: string | null } | { ok: false; detail: string } {
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > AGENT_MAX) {
    return { ok: false, detail: "Агент пользователя длиннее 2000 символов." };
  }
  return { ok: true, value: text };
}

function parseAddress(
  raw: string,
): { ok: true; ip: string; port: number | null } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: false };
  const colon = text.lastIndexOf(":");
  if (colon > 0) {
    const ip = text.slice(0, colon);
    const portText = text.slice(colon + 1);
    if (!isIpv4(ip) || !/^\d{1,5}$/.test(portText)) return { ok: false };
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false };
    return { ok: true, ip, port };
  }
  if (!isIpv4(text)) return { ok: false };
  return { ok: true, ip: text, port: null };
}

function isIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255 && String(n) === String(Number(part));
  });
}

function clip(value: string): string {
  const text = value.trim();
  if (text.length <= 80) return text;
  return `${text.slice(0, 80)}…`;
}
