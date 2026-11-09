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
  telnumCardView,
  type VatsDomainCard,
  type VatsTelnumCard,
} from "@/modules/vats/card";
import { VATS_PAGE_SIZE } from "@/modules/vats/cadence";
import {
  getDomain,
  getDomains,
  getTelnum,
  parseNameList,
  putDomainField,
  type BossAuth,
} from "@/modules/vats/client";
import {
  isVatsCycleRunning,
  requestVatsRestart,
  vatsGeneration,
} from "@/modules/vats/control";
import {
  runVatsPass,
  type SectionOutcome,
  type VatsPassResult,
} from "@/modules/vats/cycle";
import {
  MSG_CREDENTIALS,
  MSG_NOT_LIST,
  resolveRefs,
  uniqueInOrder,
} from "@/modules/vats/labels";
import { withBossLock } from "@/modules/vats/lock";
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
import {
  toDomainTable,
  toTelnumTable,
  settingsLists,
  type DomainTableRow,
  type TelnumTableRow,
} from "@/modules/vats/rows";
import {
  createPrismaCycleStore,
  domainMember,
  domainPage,
  readCatalogScreen,
  readDomainScreen,
  readGatewayCatalog,
  readTelnumScreen,
  stampDomainClient,
  telnumMember,
  telnumPage,
} from "@/modules/vats/store";
import type { VatsCatalogs, VatsSettingsView } from "@/modules/vats/views";

export type { VatsCatalogs, VatsSettingsView };

export type VatsCardResult<T> =
  { ok: true; card: T } | { ok: false; status: number; error: string };

export type VatsDomainWrite =
  | { ok: true; card: VatsDomainCard; sent: boolean }
  | { ok: false; status: number; error: string; card?: VatsDomainCard };

export type VatsTablePage<T> = {
  configured: boolean;
  readAt: string | null;
  notice: string | null;
  total: number;
  rows: T[];
};

export type VatsStatusBody = {
  loading: boolean;
  domains: { readAt: string | null; notice: string | null };
  telnums: { readAt: string | null; notice: string | null };
  settings: { readAt: string | null; notice: string | null };
};

let writeTail: Promise<void> = Promise.resolve();

function enqueueWrite<T>(job: () => Promise<T>): Promise<T> {
  const run = writeTail.then(job, job);
  writeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function platformError(error: string): { ok: false; status: 502; error: string } {
  return { ok: false, status: 502, error };
}

async function loadCreds(): Promise<
  { ok: true; auth: BossAuth } | { ok: false; error: string }
> {
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
  if (
    !origin ||
    !login ||
    !row?.vatsBossPasswordCiphertext ||
    origin !== row.vatsBossBaseUrl
  ) {
    return { ok: false, error: MSG_CREDENTIALS };
  }
  try {
    const password = getSecretEncryptionService().decrypt(
      deserializeEncryptedSecret(row.vatsBossPasswordCiphertext),
    );
    if (parseVatsPassword(password) !== password) {
      return {
        ok: false,
        error: "Сохранённый пароль ВАТС недопустим. Сохраните его снова.",
      };
    }
    return { ok: true, auth: { origin, login, password } };
  } catch {
    logger.error("vats.secret.unreadable");
    return { ok: false, error: "Пароль ВАТС не читается. Сохраните его снова." };
  }
}

async function hostView(): Promise<{ origin: string | null; configured: boolean }> {
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
    origin &&
    row?.vatsBossLogin &&
    row.vatsBossPasswordCiphertext &&
    origin === row.vatsBossBaseUrl,
  );
  return { origin: configured ? origin : null, configured };
}

function shown(
  configured: boolean,
  screen: { readAt: string | null; notice: string | null },
): { readAt: string | null; notice: string | null } {
  if (!configured) return { readAt: null, notice: MSG_CREDENTIALS };
  return { readAt: screen.readAt, notice: screen.notice };
}

async function recordCycleJob(input: {
  ok: boolean;
  error: string | null;
  startedAt: Date;
  domains: SectionOutcome;
  telnums: SectionOutcome;
  domainCount: number | null;
  telnumCount: number | null;
  settingsComplete: boolean;
}): Promise<void> {
  try {
    const finishedAt = new Date();
    await prisma.jobRun.create({
      data: {
        actionCode: "vats.sync",
        trigger: "schedule",
        status: input.ok ? "success" : "failed",
        startedAt: input.startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - input.startedAt.getTime(),
        errorMessage: input.error,
        actorUserId: null,
        meta: {
          domains: input.domains,
          telnums: input.telnums,
          domainCount: input.domainCount,
          telnumCount: input.telnumCount,
          settings: input.settingsComplete ? "complete" : "incomplete",
        },
      },
    });
  } catch {
    logger.error("vats.job.skip");
  }
}

export async function runScheduledVatsCycle(): Promise<void> {
  const creds = await loadCreds();
  if (!creds.ok) return;
  const generation = vatsGeneration();
  const startedAt = new Date();
  let result: VatsPassResult;
  try {
    result = await runVatsPass({
      auth: creds.auth,
      store: createPrismaCycleStore(creds.auth.origin, generation),
    });
  } catch {
    logger.error("vats.cycle.failed");
    return;
  }
  if (!result.called) return;
  if (result.aborted && !result.platformFailure) return;
  await recordCycleJob({
    ok: !result.platformFailure,
    error: result.platformFailure ? result.error : null,
    startedAt,
    domains: result.domains,
    telnums: result.telnums,
    domainCount: result.domainCount,
    telnumCount: result.telnumCount,
    settingsComplete: result.settingsComplete,
  });
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
): Promise<
  { ok: true; settings: VatsSettingsView } | { ok: false; status: number; error: string }
> {
  const origin = parseVatsOrigin(input.baseUrl);
  const login = parseVatsLogin(input.login);
  if (!origin || !login) {
    return { ok: false, status: 400, error: "Нужен https-хост без пути и логин." };
  }
  const existing = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { vatsBossPasswordCiphertext: true },
  });
  const write = passwordWrite(
    input.password,
    Boolean(existing?.vatsBossPasswordCiphertext),
  );
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
  requestVatsRestart();

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

export async function checkVatsAccess(): Promise<
  { ok: true; count: number } | { ok: false; status: number; error: string }
> {
  const creds = await loadCreds();
  if (!creds.ok) return { ok: false, status: 400, error: creds.error };
  const response = await withBossLock(() => getDomains(creds.auth));
  if (!response.ok) return platformError(response.error);
  const names = parseNameList(response.data, parseDomainName);
  if (!names) return platformError(MSG_NOT_LIST);
  return { ok: true, count: uniqueInOrder(names).length };
}

export async function getVatsDomainPage(
  offset: number,
): Promise<VatsTablePage<DomainTableRow>> {
  const host = await hostView();
  const loaded = await readDomainScreen(host.origin);
  const view = shown(host.configured, loaded.screen);
  const rows = host.configured ? domainPage(loaded.rows, offset, VATS_PAGE_SIZE) : [];
  return {
    configured: host.configured,
    readAt: view.readAt,
    notice: view.notice,
    total: host.configured ? loaded.rows.length : 0,
    rows: rows.map(toDomainTable),
  };
}

export async function getVatsTelnumPage(
  offset: number,
): Promise<VatsTablePage<TelnumTableRow>> {
  const host = await hostView();
  const loaded = await readTelnumScreen(host.origin);
  const view = shown(host.configured, loaded.screen);
  const rows = host.configured ? telnumPage(loaded.rows, offset, VATS_PAGE_SIZE) : [];
  return {
    configured: host.configured,
    readAt: view.readAt,
    notice: view.notice,
    total: host.configured ? loaded.rows.length : 0,
    rows: rows.map(toTelnumTable),
  };
}

export async function getVatsStatus(): Promise<VatsStatusBody> {
  const host = await hostView();
  const [domains, telnums, catalogs] = await Promise.all([
    readDomainScreen(host.origin),
    readTelnumScreen(host.origin),
    readCatalogScreen(host.origin),
  ]);
  return {
    loading: isVatsCycleRunning(),
    domains: shown(host.configured, domains.screen),
    telnums: shown(host.configured, telnums.screen),
    settings: shown(host.configured, catalogs.screen),
  };
}

export async function getVatsCatalogView(): Promise<VatsCatalogs> {
  const host = await hostView();
  const loaded = await readCatalogScreen(host.origin);
  return settingsLists(loaded.snap);
}

export function getDomainCard(domain: string): Promise<VatsCardResult<VatsDomainCard>> {
  return (async () => {
    if (parseDomainName(domain) !== domain) {
      return { ok: false, status: 400, error: "Недопустимое имя домена." };
    }
    const creds = await loadCreds();
    if (!creds.ok) return { ok: false, status: 400, error: creds.error };
    if (!(await domainMember(creds.auth.origin, domain))) {
      return {
        ok: false,
        status: 409,
        error: "Этого домена нет в списке текущего хоста.",
      };
    }
    const response = await withBossLock(() => getDomain(creds.auth, domain));
    if (!response.ok) return platformError(response.error);
    const raw = asRecord(response.data);
    if (!raw) return platformError("Платформа вернула не карточку домена.");
    return { ok: true, card: domainCardView(domain, raw) };
  })();
}

export function getTelnumCard(telnum: string): Promise<VatsCardResult<VatsTelnumCard>> {
  return (async () => {
    if (parseTelnum(telnum) !== telnum) {
      return { ok: false, status: 400, error: "Недопустимый номер." };
    }
    const creds = await loadCreds();
    if (!creds.ok) return { ok: false, status: 400, error: creds.error };
    if (!(await telnumMember(creds.auth.origin, telnum))) {
      return {
        ok: false,
        status: 409,
        error: "Этого номера нет в списке текущего хоста.",
      };
    }
    const response = await withBossLock(() => getTelnum(creds.auth, telnum));
    if (!response.ok) return platformError(response.error);
    const raw = asRecord(response.data);
    if (!raw) return platformError("Платформа вернула не карточку номера.");
    const card = telnumCardView(telnum, raw);
    const catalog = await readGatewayCatalog(creds.auth.origin);
    return { ok: true, card: { ...card, gateways: resolveRefs(card.gateways, catalog) } };
  })();
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
  return enqueueWrite(async () => {
    if (parseDomainName(input.domain) !== input.domain) {
      return { ok: false, status: 400, error: "Недопустимое имя домена." };
    }
    const value =
      input.field === "client"
        ? parseClientValue(input.value)
        : parseLanguageValue(input.value);
    if (value == null) return { ok: false, status: 400, error: "Недопустимое значение." };
    if (
      input.expected != null &&
      (input.expected.length > 500 || /[\u0000-\u001F\u007F]/.test(input.expected))
    ) {
      return { ok: false, status: 400, error: "Недопустимое прежнее значение." };
    }
    const creds = await loadCreds();
    if (!creds.ok) return { ok: false, status: 400, error: creds.error };
    if (!(await domainMember(creds.auth.origin, input.domain))) {
      return {
        ok: false,
        status: 409,
        error: "Этого домена нет в списке текущего хоста. Запрос не отправлен.",
      };
    }

    const before = await withBossLock(() => getDomain(creds.auth, input.domain));
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
    if (currentText === value) {
      if (input.field === "client")
        await stampDomainClient(creds.auth.origin, input.domain, value);
      return { ok: true, card, sent: false };
    }

    const written = await withBossLock(() =>
      putDomainField(creds.auth, input.domain, input.field, value),
    );
    if (!written.ok) {
      await auditDomain(
        {
          domain: input.domain,
          field: input.field,
          before: currentText,
          after: value,
          outcome: "rejected",
        },
        actor,
      );
      return platformError(written.error);
    }

    const after = await withBossLock(() => getDomain(creds.auth, input.domain));
    if (!after.ok) {
      await auditDomain(
        {
          domain: input.domain,
          field: input.field,
          before: currentText,
          after: value,
          outcome: "unchecked",
        },
        actor,
      );
      return platformError(
        "Запись отправлена, но проверка чтением не удалась. Повторный запрос не отправлен.",
      );
    }
    const afterRaw = asRecord(after.data);
    if (
      !afterRaw ||
      afterRaw[input.field] !== value ||
      !readbackAccepts(raw, afterRaw, input.field, value)
    ) {
      await auditDomain(
        {
          domain: input.domain,
          field: input.field,
          before: currentText,
          after: value,
          outcome: "readback",
        },
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
      {
        domain: input.domain,
        field: input.field,
        before: currentText,
        after: value,
        outcome: "saved",
      },
      actor,
    );
    if (input.field === "client")
      await stampDomainClient(creds.auth.origin, input.domain, value);
    return { ok: true, card: domainCardView(input.domain, afterRaw), sent: true };
  });
}
