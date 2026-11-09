import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit/service";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";
import {
  asRecord,
  domainCardView,
  parseCatalog,
  telnumCardView,
  type VatsDomainCard,
  type VatsTelnumCard,
} from "@/modules/vats/card";
import {
  getDialplans,
  getDomain,
  getDomains,
  getGateways,
  getRoutes,
  getTelnum,
  getTelnums,
  parseNameList,
  putDomainField,
  type BossAuth,
} from "@/modules/vats/client";
import {
  parseClientValue,
  parseDomainName,
  parseLanguageValue,
  parseTelnum,
  parseVatsLogin,
  parseVatsPassword,
  passwordWrite,
} from "@/modules/vats/names";
import { parseVatsOrigin } from "@/modules/vats/origin";
import { readbackAccepts } from "@/modules/vats/readback";
import { keptPreviousList, nextNameList, type StoredNameList } from "@/modules/vats/snapshot";
import type { VatsCatalogs, VatsSettingsView } from "@/modules/vats/views";

const MISSING_CREDENTIALS = "Укажите хост, логин и пароль в Настройках ВАТС.";

export type { VatsCatalogs, VatsSettingsView };

export type VatsNameSnapshot = {
  names: string[];
  readAt: string | null;
  configured: boolean;
};

export type VatsListResult =
  | { ok: true; names: string[]; readAt: string | null; notice: string | null }
  | { ok: false; status: number; error: string };

export type VatsCardResult<T> =
  | { ok: true; card: T }
  | { ok: false; status: number; error: string };

export type VatsDomainWrite =
  | { ok: true; card: VatsDomainCard; sent: boolean }
  | { ok: false; status: number; error: string; card?: VatsDomainCard };

type NameKind = "domains" | "telnums";

type StoredRow = StoredNameList & { readAt: Date };

let listTail: Promise<void> = Promise.resolve();
let writeTail: Promise<void> = Promise.resolve();

function enqueue<T>(slot: "list" | "write", job: () => Promise<T>): Promise<T> {
  const prev = slot === "list" ? listTail : writeTail;
  const run = prev.then(job, job);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  if (slot === "list") listTail = settled;
  else writeTail = settled;
  return run;
}

function platformError(error: string): { ok: false; status: 502; error: string } {
  return { ok: false, status: 502, error };
}

async function loadCreds(): Promise<{ ok: true; auth: BossAuth } | { ok: false; error: string }> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      vatsBossBaseUrl: true,
      vatsBossLogin: true,
      vatsBossPasswordCiphertext: true,
    },
  });
  const origin = row?.vatsBossBaseUrl ? parseVatsOrigin(row.vatsBossBaseUrl) : null;
  const login = row?.vatsBossLogin ? parseVatsLogin(row.vatsBossLogin) : null;
  if (!origin || !login || !row?.vatsBossPasswordCiphertext || origin !== row.vatsBossBaseUrl) {
    return { ok: false, error: MISSING_CREDENTIALS };
  }
  try {
    const password = getSecretEncryptionService().decrypt(
      deserializeEncryptedSecret(row.vatsBossPasswordCiphertext),
    );
    if (parseVatsPassword(password) !== password) {
      return { ok: false, error: "Сохранённый пароль ВАТС недопустим. Сохраните его снова." };
    }
    return { ok: true, auth: { origin, login, password } };
  } catch {
    logger.error("vats.secret.unreadable");
    return { ok: false, error: "Пароль ВАТС не читается. Сохраните его снова." };
  }
}

async function readStored(
  kind: NameKind,
  accept: (value: string) => string | null,
): Promise<StoredRow | null> {
  const row = await prisma.vatsNameList.findUnique({ where: { kind } });
  if (!row) return null;
  return {
    origin: row.origin,
    names: parseNameList(row.names, accept) ?? [],
    readAt: row.readAt,
  };
}

function shown(row: StoredRow | null, origin: string): { names: string[]; readAt: string | null } {
  if (!row || row.origin !== origin) return { names: [], readAt: null };
  return { names: row.names, readAt: row.readAt.toISOString() };
}

async function recordJob(input: {
  actorUserId: string;
  kind: NameKind;
  ok: boolean;
  error: string | null;
  count: number | null;
  kept: boolean;
  startedAt: Date;
}): Promise<void> {
  try {
    const finishedAt = new Date();
    await prisma.jobRun.create({
      data: {
        actionCode: "vats.sync",
        trigger: "manual",
        status: input.ok ? "success" : "failed",
        startedAt: input.startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - input.startedAt.getTime(),
        errorMessage: input.error,
        actorUserId: input.actorUserId,
        meta: {
          kind: input.kind,
          ...(input.count != null ? { count: input.count } : {}),
          ...(input.kept ? { kept: true } : {}),
        },
      },
    });
  } catch {
    logger.error("vats.job.skip");
  }
}

export async function getVatsSettings(): Promise<VatsSettingsView> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      vatsBossBaseUrl: true,
      vatsBossLogin: true,
      vatsBossPasswordCiphertext: true,
    },
  });
  return {
    baseUrl: row?.vatsBossBaseUrl ?? "",
    login: row?.vatsBossLogin ?? "",
    hasPassword: Boolean(row?.vatsBossPasswordCiphertext),
  };
}

export async function saveVatsSettings(
  input: { baseUrl: string; login: string; password?: string },
  actor: { userId: string; ip: string | null },
): Promise<{ ok: true; settings: VatsSettingsView } | { ok: false; status: number; error: string }> {
  const origin = parseVatsOrigin(input.baseUrl);
  const login = parseVatsLogin(input.login);
  if (!origin || !login) {
    return { ok: false, status: 400, error: "Нужен https-хост без пути и логин." };
  }
  const existing = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { vatsBossPasswordCiphertext: true },
  });
  const write = passwordWrite(input.password, Boolean(existing?.vatsBossPasswordCiphertext));
  if (write === "missing") return { ok: false, status: 400, error: "Укажите пароль." };
  let ciphertext: string | undefined;
  if (write === "replace" && input.password != null) {
    const password = parseVatsPassword(input.password);
    if (!password) return { ok: false, status: 400, error: "Недопустимый пароль." };
    ciphertext = serializeEncryptedSecret(getSecretEncryptionService().encrypt(password));
  }

  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      vatsBossBaseUrl: origin,
      vatsBossLogin: login,
      vatsBossPasswordCiphertext: ciphertext ?? null,
    },
    update: {
      vatsBossBaseUrl: origin,
      vatsBossLogin: login,
      ...(ciphertext ? { vatsBossPasswordCiphertext: ciphertext } : {}),
    },
  });

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.VATS_SETTINGS_UPDATE,
    entityType: "vats_settings",
    entityId: "1",
    ip: actor.ip,
    meta: { baseUrl: origin, login, replacedCredential: Boolean(ciphertext) },
  });

  return {
    ok: true,
    settings: { baseUrl: origin, login, hasPassword: true },
  };
}

async function refreshLocked(kind: NameKind, actorUserId: string): Promise<VatsListResult> {
  const creds = await loadCreds();
  if (!creds.ok) return { ok: false, status: 400, error: creds.error };
  const accept = kind === "domains" ? parseDomainName : parseTelnum;
  const startedAt = new Date();
  const response = kind === "domains" ? await getDomains(creds.auth) : await getTelnums(creds.auth);
  if (!response.ok) {
    await recordJob({
      actorUserId,
      kind,
      ok: false,
      error: response.error,
      count: null,
      kept: false,
      startedAt,
    });
    return platformError(response.error);
  }
  const parsed = parseNameList(response.data, accept);
  if (parsed == null) {
    const error = "Платформа вернула не список имён.";
    await recordJob({
      actorUserId,
      kind,
      ok: false,
      error,
      count: null,
      kept: false,
      startedAt,
    });
    return platformError(error);
  }
  const stored = await readStored(kind, accept);
  const kept = keptPreviousList(stored, parsed);
  const decided = nextNameList(stored, creds.auth.origin, parsed);
  let row: StoredRow | null = stored;
  if (!kept && decided) {
    const readAt = new Date();
    await prisma.vatsNameList.upsert({
      where: { kind },
      create: { kind, origin: decided.origin, names: decided.names, readAt },
      update: { origin: decided.origin, names: decided.names, readAt },
    });
    row = { ...decided, readAt };
  }
  await recordJob({
    actorUserId,
    kind,
    ok: true,
    error: null,
    count: parsed.length,
    kept,
    startedAt,
  });
  const visible = shown(row, creds.auth.origin);
  return {
    ok: true,
    names: visible.names,
    readAt: visible.readAt,
    notice: kept ? "Пустой ответ не заменил сохранённый список." : null,
  };
}

export function refreshVatsDomains(actorUserId: string): Promise<VatsListResult> {
  return enqueue("list", () => refreshLocked("domains", actorUserId));
}

export function refreshVatsTelnums(actorUserId: string): Promise<VatsListResult> {
  return enqueue("list", () => refreshLocked("telnums", actorUserId));
}

export async function listVatsDomains(): Promise<VatsNameSnapshot> {
  return listNames("domains", parseDomainName);
}

export async function listVatsTelnums(): Promise<VatsNameSnapshot> {
  return listNames("telnums", parseTelnum);
}

async function listNames(
  kind: NameKind,
  accept: (value: string) => string | null,
): Promise<VatsNameSnapshot> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      vatsBossBaseUrl: true,
      vatsBossLogin: true,
      vatsBossPasswordCiphertext: true,
    },
  });
  const origin = row?.vatsBossBaseUrl ? parseVatsOrigin(row.vatsBossBaseUrl) : null;
  const configured = Boolean(
    origin && row?.vatsBossLogin && row.vatsBossPasswordCiphertext && origin === row.vatsBossBaseUrl,
  );
  if (!configured || !origin) return { names: [], readAt: null, configured: false };
  const stored = await readStored(kind, accept);
  const visible = shown(stored, origin);
  return { ...visible, configured: true };
}

async function memberOf(kind: NameKind, origin: string, name: string): Promise<boolean> {
  const accept = kind === "domains" ? parseDomainName : parseTelnum;
  const stored = await readStored(kind, accept);
  return Boolean(stored && stored.origin === origin && stored.names.includes(name));
}

export function getDomainCard(domain: string): Promise<VatsCardResult<VatsDomainCard>> {
  return enqueue("list", async () => {
    if (parseDomainName(domain) !== domain) {
      return { ok: false, status: 400, error: "Недопустимое имя домена." };
    }
    const creds = await loadCreds();
    if (!creds.ok) return { ok: false, status: 400, error: creds.error };
    if (!(await memberOf("domains", creds.auth.origin, domain))) {
      return {
        ok: false,
        status: 409,
        error: "Этого домена нет в списке текущего хоста. Обновите список.",
      };
    }
    const response = await getDomain(creds.auth, domain);
    if (!response.ok) return platformError(response.error);
    const raw = asRecord(response.data);
    if (!raw) return platformError("Платформа вернула не карточку домена.");
    return { ok: true, card: domainCardView(domain, raw) };
  });
}

export function getTelnumCard(telnum: string): Promise<VatsCardResult<VatsTelnumCard>> {
  return enqueue("list", async () => {
    if (parseTelnum(telnum) !== telnum) {
      return { ok: false, status: 400, error: "Недопустимый номер." };
    }
    const creds = await loadCreds();
    if (!creds.ok) return { ok: false, status: 400, error: creds.error };
    if (!(await memberOf("telnums", creds.auth.origin, telnum))) {
      return {
        ok: false,
        status: 409,
        error: "Этого номера нет в списке текущего хоста. Обновите список.",
      };
    }
    const response = await getTelnum(creds.auth, telnum);
    if (!response.ok) return platformError(response.error);
    const raw = asRecord(response.data);
    if (!raw) return platformError("Платформа вернула не карточку номера.");
    return { ok: true, card: telnumCardView(telnum, raw) };
  });
}

export function loadVatsCatalogs(): Promise<VatsCatalogs> {
  return enqueue("list", async () => {
    const creds = await loadCreds();
    if (!creds.ok) return { gateways: [], routes: [], dialplans: [], error: null };
    const empty = { gateways: [] as string[], routes: [] as string[], dialplans: [] as string[] };
    const gateways = await getGateways(creds.auth);
    if (!gateways.ok) return { ...empty, error: gateways.error };
    const gatewayNames = parseCatalog(gateways.data);
    if (!gatewayNames) return { ...empty, error: "Платформа вернула не список шлюзов." };
    const routes = await getRoutes(creds.auth);
    if (!routes.ok) return { ...empty, gateways: gatewayNames, error: routes.error };
    const routeNames = parseCatalog(routes.data);
    if (!routeNames) return { ...empty, gateways: gatewayNames, error: "Платформа вернула не список маршрутов." };
    const dialplans = await getDialplans(creds.auth);
    if (!dialplans.ok) {
      return { gateways: gatewayNames, routes: routeNames, dialplans: [], error: dialplans.error };
    }
    const dialplanNames = parseCatalog(dialplans.data);
    if (!dialplanNames) {
      return {
        gateways: gatewayNames,
        routes: routeNames,
        dialplans: [],
        error: "Платформа вернула не список диал-планов.",
      };
    }
    return {
      gateways: gatewayNames,
      routes: routeNames,
      dialplans: dialplanNames,
      error: null,
    };
  });
}

async function auditDomain(
  input: {
    domain: string;
    field: "client" | "language";
    before: string | null;
    after: string;
    outcome: "saved" | "rejected" | "unchecked" | "readback";
  },
  actor: { userId: string; ip: string | null },
): Promise<void> {
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.VATS_DOMAIN_UPDATE,
    entityType: "vats_domain",
    entityId: input.domain,
    ip: actor.ip,
    meta: input,
  });
}

export function changeDomainField(
  input: {
    domain: string;
    field: "client" | "language";
    value: string;
    expected: string | null;
  },
  actor: { userId: string; ip: string | null },
): Promise<VatsDomainWrite> {
  return enqueue("write", async () => {
    if (parseDomainName(input.domain) !== input.domain) {
      return { ok: false, status: 400, error: "Недопустимое имя домена." };
    }
    const value =
      input.field === "client" ? parseClientValue(input.value) : parseLanguageValue(input.value);
    if (value == null) return { ok: false, status: 400, error: "Недопустимое значение." };
    if (
      input.expected != null &&
      (input.expected.length > 500 || /[\u0000-\u001F\u007F]/.test(input.expected))
    ) {
      return { ok: false, status: 400, error: "Недопустимое прежнее значение." };
    }
    const creds = await loadCreds();
    if (!creds.ok) return { ok: false, status: 400, error: creds.error };
    if (!(await memberOf("domains", creds.auth.origin, input.domain))) {
      return {
        ok: false,
        status: 409,
        error: "Этого домена нет в списке текущего хоста. Обновите список. Запрос не отправлен.",
      };
    }

    const before = await getDomain(creds.auth, input.domain);
    if (!before.ok) return platformError(before.error);
    const raw = asRecord(before.data);
    if (!raw) return platformError("Платформа вернула не карточку домена.");
    const current = raw[input.field];
    if (current != null && typeof current !== "string") {
      return {
        ok: false,
        status: 409,
        error: "Поле имеет неожиданный тип. Запрос не отправлен.",
        card: domainCardView(input.domain, raw),
      };
    }
    const currentText = current == null ? null : current;
    const card = domainCardView(input.domain, raw);
    if (currentText !== input.expected) {
      return {
        ok: false,
        status: 409,
        error: "Значение уже другое. Обновите карточку. Запрос не отправлен.",
        card,
      };
    }
    if (currentText === value) return { ok: true, card, sent: false };

    const written = await putDomainField(creds.auth, input.domain, input.field, value);
    if (!written.ok) {
      await auditDomain(
        { domain: input.domain, field: input.field, before: currentText, after: value, outcome: "rejected" },
        actor,
      );
      return platformError(written.error);
    }

    const after = await getDomain(creds.auth, input.domain);
    if (!after.ok) {
      await auditDomain(
        { domain: input.domain, field: input.field, before: currentText, after: value, outcome: "unchecked" },
        actor,
      );
      return platformError(
        "Запись отправлена, но проверка чтением не удалась. Повторный запрос не отправлен.",
      );
    }
    const afterRaw = asRecord(after.data);
    if (!afterRaw || afterRaw[input.field] !== value || !readbackAccepts(raw, afterRaw, input.field, value)) {
      await auditDomain(
        { domain: input.domain, field: input.field, before: currentText, after: value, outcome: "readback" },
        actor,
      );
      const otherFieldChanged = Boolean(afterRaw && afterRaw[input.field] === value);
      return {
        ok: false,
        status: 502,
        error: otherFieldChanged
          ? "После записи изменилось другое поле. Повторный запрос не отправлен."
          : "Проверка не увидела новое значение. Повторный запрос не отправлен.",
        ...(afterRaw ? { card: domainCardView(input.domain, afterRaw) } : {}),
      };
    }
    await auditDomain(
      { domain: input.domain, field: input.field, before: currentText, after: value, outcome: "saved" },
      actor,
    );
    return { ok: true, card: domainCardView(input.domain, afterRaw), sent: true };
  });
}
