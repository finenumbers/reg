import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { confirmActivationDiff } from "@/modules/phones/activation-diff";
import { sendActivationUpdate } from "@/modules/phones/activation-write";
import type { ActivationWriteAttempt } from "@/modules/phones/activation-write";
import type { ActivationUpdateCommand } from "@/modules/rtu-soap/activation-envelope";
import { processPhonesSync } from "@/modules/phones/phones-sync-processor";
import type { PhonesSyncProcessorResult } from "@/modules/phones/phones-sync-processor";
import { readStoredEquipment } from "@/modules/phones/rtu-read";
import type { EquipmentRead } from "@/modules/phones/rtu-read";
import type { EquipmentIdentity } from "@/modules/phones/rtu-rows";
import {
  STATUS_ACTIVE,
  STATUS_BLOCKED,
  STATUS_FIELD,
  type PhoneRowData,
} from "@/modules/phones/types";
import { loadRtuSoapAccount } from "@/modules/rtu-soap/credentials";
import { jobRuntime } from "@/modules/jobs/runtime";

const REG_PASSWORD = "Регистрационный пароль";
const BUSY = "Идёт загрузка телефонных номеров. Повторите, когда она закончится.";
const NOT_SENT = "Смена статуса не выполнена. Запись не отправлена.";
const UNCONFIRMED =
  "Результат смены не подтверждён загрузкой телефонных номеров. Повторная запись не отправлена.";
const CATALOG_LAG =
  "Коммутатор сменил статус, каталог не обновился. Повторная запись не отправлена. Дождитесь следующей загрузки номеров.";
const NOT_FOUND = "Строка каталога не найдена. Запись не отправлена.";
const MANY_NUMBERS =
  "Номер есть в каталоге больше одного раза. Обновите страницу. Запись не отправлена.";
const ROW_CHANGED =
  "Строка каталога изменилась. Обновите страницу. Запись не отправлена.";
const TITLE_FIELD = "Название";
const TITLE_MAX = 500;

export type ActivationRequest = {
  endpointId: string;
  phone: string;
  activation: typeof STATUS_ACTIVE | typeof STATUS_BLOCKED;
  title: string;
};

export type ActivationResult = {
  ok: boolean;
  busy?: boolean;
  message: string;
};

type CatalogEndpoint = {
  id: string;
  name: string;
  endpointNumber: string | null;
  data: unknown;
};

export type ActivationDeps = {
  occupy: <T>(
    run: () => Promise<T>,
  ) => Promise<{ accepted: true; value: T } | { accepted: false }>;
  loadEndpoint: (id: string) => Promise<CatalogEndpoint | null>;
  loadByNumber: (phone: string) => Promise<CatalogEndpoint[]>;
  countTwins: (name: string, number: string, id: string) => Promise<number>;
  read: () => Promise<EquipmentRead>;
  write: (
    command: ActivationUpdateCommand,
    rowPassword: string,
  ) => Promise<ActivationWriteAttempt>;
  sync: (actorUserId: string) => Promise<PhonesSyncProcessorResult>;
  audit: (
    meta: Record<string, unknown>,
    actorUserId: string,
    entityId: string,
  ) => Promise<void>;
};

export function parseActivationBody(
  value: unknown,
): ActivationRequest | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Некорректный запрос." };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 4 ||
    !keys.includes("endpointId") ||
    !keys.includes("phone") ||
    !keys.includes("activation") ||
    !keys.includes("title")
  ) {
    return { error: "Некорректный запрос." };
  }
  if (
    typeof record.endpointId !== "string" ||
    typeof record.phone !== "string" ||
    typeof record.activation !== "string" ||
    typeof record.title !== "string"
  ) {
    return { error: "Некорректный запрос." };
  }
  const endpointId = record.endpointId.trim();
  if (endpointId.startsWith("did:")) {
    return { error: "Некорректный запрос." };
  }
  const phone = record.phone.trim();
  const activation = catalogSpaceTrim(record.activation);
  const title = catalogSpaceTrim(record.title);
  if (
    !endpointId ||
    !phone ||
    !title ||
    endpointId.length > 64 ||
    phone.length > 64 ||
    title.length > TITLE_MAX ||
    (activation !== STATUS_ACTIVE && activation !== STATUS_BLOCKED) ||
    /[\r\n\0]/.test(record.endpointId) ||
    /[\r\n\0]/.test(record.phone) ||
    /[\r\n\0]/.test(record.title)
  ) {
    return { error: "Некорректный запрос." };
  }
  return { endpointId, phone, activation, title };
}

/** PostgreSQL `btrim`: only U+0020, matching the geography list. */
export function catalogSpaceTrim(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 32) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 32) end -= 1;
  return value.slice(start, end);
}

/** List title: non-empty «Название», otherwise the equipment name. */
export function catalogDisplayTitle(name: string, data: unknown): string {
  const titled = catalogSpaceTrim(textOf(data, TITLE_FIELD));
  if (titled !== "") return titled;
  return catalogSpaceTrim(name);
}

export async function changeEndpointActivation(
  input: ActivationRequest & { actorUserId: string },
  deps: ActivationDeps = defaultDeps(),
): Promise<ActivationResult> {
  const held = await deps.occupy(() => runActivation(input, deps));
  if (!held.accepted) return { ok: false, busy: true, message: BUSY };
  return held.value;
}

async function runActivation(
  input: ActivationRequest & { actorUserId: string },
  deps: ActivationDeps,
): Promise<ActivationResult> {
  let sent = false;
  let resolvedId = input.endpointId;
  try {
    if (input.endpointId.startsWith("did:")) {
      return finish(deps, input, input.endpointId, "Некорректный запрос.", false);
    }
    let row = await deps.loadEndpoint(input.endpointId);
    if (!row) {
      const found = await deps.loadByNumber(input.phone);
      if (found.length !== 1 || !found[0]) {
        return finish(
          deps,
          input,
          input.endpointId,
          found.length > 1 ? MANY_NUMBERS : NOT_FOUND,
          false,
        );
      }
      row = found[0];
    }
    resolvedId = row.id;
    const phone = input.phone.trim();
    const stored = row.endpointNumber?.trim() ?? "";
    const name = row.name.trim();
    if (!name) {
      return finish(
        deps,
        input,
        row.id,
        "У строки нет названия. Запись не отправлена.",
        false,
      );
    }
    if (!stored || stored !== phone) {
      return finish(
        deps,
        input,
        row.id,
        "Введённый номер не совпадает с этой строкой. Запись не отправлена.",
        false,
      );
    }
    const from = statusOf(row.data);
    if (from !== STATUS_ACTIVE && from !== STATUS_BLOCKED) {
      return finish(
        deps,
        input,
        row.id,
        "У строки нет статуса, который можно сменить. Запись не отправлена.",
        false,
      );
    }
    if (
      from !== input.activation ||
      catalogDisplayTitle(row.name, row.data) !== input.title
    ) {
      return finish(deps, input, row.id, ROW_CHANGED, false);
    }
    if ((await deps.countTwins(name, stored, row.id)) > 0) {
      return finish(
        deps,
        input,
        row.id,
        "Номер с этим названием уже есть в каталоге дважды. Запись не отправлена.",
        false,
      );
    }
    const read = await deps.read();
    if (!read.ok)
      return finish(deps, input, row.id, `${read.detail} Запись не отправлена.`, false);
    if (!read.identities || !read.objectId || !read.pkColumn || !read.activeColumn) {
      return finish(
        deps,
        input,
        row.id,
        "Чтение оборудования неполное. Запись не отправлена.",
        false,
      );
    }
    const columnError = columnReady(read.activeColumn, read.pkColumn);
    if (columnError) return finish(deps, input, row.id, columnError, false);
    const hits = liveHits(read.identities, name, stored, from);
    if (hits.length !== 1 || !hits[0]) {
      const message =
        hits.length > 1
          ? "Номер встречается больше одного раза. Запись не отправлена."
          : "Строка на коммутаторе не совпала с каталогом. Запись не отправлена.";
      return finish(deps, input, row.id, message, false);
    }
    const hit = hits[0];
    const fromWire = from === STATUS_ACTIVE ? "1" : "0";
    const toWire = from === STATUS_ACTIVE ? "0" : "1";
    const to = from === STATUS_ACTIVE ? STATUS_BLOCKED : STATUS_ACTIVE;
    const rowPassword = passwordOf(hit.endpoint);
    const attempt = await deps.write(
      {
        objectId: read.objectId,
        pkName: read.pkColumn,
        pkValue: hit.pk,
        activeName: read.activeColumn.name,
        activeValue: toWire,
      },
      rowPassword,
    );
    if (!attempt.sent) return finish(deps, input, row.id, attempt.detail, false);
    sent = true;
    const sync = await deps.sync(input.actorUserId);
    const diff = sync.identities
      ? confirmActivationDiff({
          before: read.identities,
          after: sync.identities,
          pk: hit.pk,
          fromWire,
          toWire,
          fromStatus: from,
          toStatus: to,
        })
      : { ok: false as const, detail: UNCONFIRMED };
    if (diff.ok && sync.status === "success") {
      await record(deps, input, row.id, {
        result: "confirmed",
        from,
        to,
        soapCount: attempt.count,
      });
      return { ok: true, message: `Статус номера ${phone} теперь «${to}».` };
    }
    await record(deps, input, row.id, {
      result: diff.ok ? "catalog" : "unconfirmed",
      from,
      to,
      soapCount: attempt.count,
      fault: attempt.fault,
    });
    return { ok: false, message: diff.ok ? CATALOG_LAG : diff.detail };
  } catch {
    if (sent) {
      await record(deps, input, resolvedId, { result: "unconfirmed" });
    }
    return {
      ok: false,
      message: sent ? UNCONFIRMED : NOT_SENT,
    };
  }
}

function columnReady(
  column: {
    name: string;
    ctlType: string | null;
    action: number | null;
    actionUnreadable: boolean;
  },
  pkColumn: string,
): string | null {
  if (column.actionUnreadable || column.action == null || (column.action & 2) === 0) {
    return "Колонка «Запись активна» недоступна для обновления. Запись не отправлена.";
  }
  if ((column.ctlType ?? "").trim().toLowerCase() !== "checkbox") {
    return "Колонка «Запись активна» не является флажком. Запись не отправлена.";
  }
  if (column.name === pkColumn) {
    return "Колонка «Запись активна» совпала с ключом. Запись не отправлена.";
  }
  return null;
}

function liveHits(
  identities: readonly EquipmentIdentity[],
  name: string,
  phone: string,
  from: typeof STATUS_ACTIVE | typeof STATUS_BLOCKED,
): EquipmentIdentity[] {
  const wire = from === STATUS_ACTIVE ? "1" : "0";
  return identities.filter(
    (item) =>
      item.kind === "endpoint" &&
      item.name === name &&
      item.number === phone &&
      item.activation === from &&
      item.rawActive === wire &&
      item.endpoint != null,
  );
}

async function finish(
  deps: ActivationDeps,
  input: { phone: string; actorUserId: string },
  entityId: string,
  message: string,
  ok: boolean,
): Promise<ActivationResult> {
  await record(deps, input, entityId, { result: ok ? "confirmed" : "refused" });
  return { ok, message };
}

async function record(
  deps: ActivationDeps,
  input: { phone: string; actorUserId: string },
  entityId: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await deps.audit({ phone: input.phone, ...meta }, input.actorUserId, entityId);
  } catch {
    /* the write already happened or was refused; audit must not send another */
  }
}

function statusOf(data: unknown): string {
  return catalogSpaceTrim(textOf(data, STATUS_FIELD));
}

function textOf(data: unknown, key: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const value = (data as PhoneRowData)[key];
  return typeof value === "string" ? value : "";
}

function passwordOf(data: PhoneRowData | null): string {
  const value = data?.[REG_PASSWORD];
  return typeof value === "string" ? value : "";
}

function defaultDeps(): ActivationDeps {
  return {
    occupy: (run) => jobRuntime.occupyPhonesSync(run),
    loadEndpoint: async (id) =>
      prisma.phoneEndpoint.findUnique({
        where: { id },
        select: { id: true, name: true, endpointNumber: true, data: true },
      }),
    loadByNumber: async (phone) =>
      prisma.$queryRaw<CatalogEndpoint[]>(Prisma.sql`
        SELECT id, name, "endpointNumber", data
        FROM phone_endpoints
        WHERE btrim("endpointNumber") = ${phone}
        LIMIT 2
      `),
    countTwins: async (name, number, id) => {
      const rows = await prisma.phoneEndpoint.findMany({
        where: { name, endpointNumber: number },
        select: { id: true },
      });
      return rows.filter((row) => row.id !== id).length;
    },
    read: () => readStoredEquipment(),
    write: async (command, rowPassword) => {
      const account = await loadRtuSoapAccount();
      if (!account.ok) {
        return { sent: false, detail: "Учётка API РТУ не задана. Запись не отправлена." };
      }
      return sendActivationUpdate({ account, command, rowPassword });
    },
    sync: (actorUserId) => processPhonesSync({ trigger: "manual", actorUserId }),
    audit: async (meta, actorUserId, entityId) => {
      await auditService.append({
        actorUserId,
        action: AUDIT_ACTIONS.PHONES_ACTIVATION,
        entityType: "phone_endpoint",
        entityId,
        meta,
      });
    },
  };
}
