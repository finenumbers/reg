import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isDisplayTimezoneId, type DisplayTimezoneId } from "@/lib/display-timezone";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { duplicateFieldMessage, parseIdentifier } from "@/modules/smg-syslog/identifier";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";

const NAME_MAX = 64;
const BAD_IDENTIFIER =
  "Идентификатор: латинская буква, затем буквы, цифры или _, до 32 символов";
const BAD_TIMEZONE = "Пояс CDR — UTC, Калининград, Москва или Новосибирск";
const ANTIFRAUD_NEEDS_IDENTIFIER = "Чтобы выключить АнтиФрод, укажите идентификатор";
const ANTIFRAUD_KEEPS_IDENTIFIER =
  "Нельзя очистить идентификатор, пока АнтиФрод выключен";

export type SyslogNode = {
  ip: string;
  name: string;
  identifier: string | null;
  cdrTimezone: string;
  antifraudEnabled: boolean;
};

const nodeSelect = {
  ip: true,
  name: true,
  identifier: true,
  cdrTimezone: true,
  antifraudEnabled: true,
} as const;

export class SyslogNodeError extends Error {
  constructor(
    readonly code:
      | "BAD_IP"
      | "BAD_NAME"
      | "BAD_IDENTIFIER"
      | "BAD_TIMEZONE"
      | "ANTIFRAUD_IDENTIFIER"
      | "DUPLICATE"
      | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) {
    throw new SyslogNodeError("BAD_NAME", "Название узла — от 1 до 64 символов");
  }
  if (/[\r\n\0]/.test(trimmed)) {
    throw new SyslogNodeError(
      "BAD_NAME",
      "Название узла не может содержать перевод строки",
    );
  }
  return trimmed;
}

function cleanIp(ip: string): string {
  const canonical = canonicalIpv4(ip);
  if (!canonical) {
    throw new SyslogNodeError("BAD_IP", "Укажите IPv4 без лидирующих нулей");
  }
  return canonical;
}

function cleanIdentifier(raw: string, required: boolean): string | null {
  const parsed = parseIdentifier(raw, required);
  if (!parsed.ok) throw new SyslogNodeError("BAD_IDENTIFIER", BAD_IDENTIFIER);
  return parsed.value;
}

function cleanCdrTimezone(raw: string): DisplayTimezoneId {
  if (isDisplayTimezoneId(raw)) return raw;
  throw new SyslogNodeError("BAD_TIMEZONE", BAD_TIMEZONE);
}

/** Off without an identifier would leave the call table on the stored card. */
export function assertAntifraudIdentifier(input: {
  enabled: boolean;
  identifier: string | null;
  identifierCleared: boolean;
}): void {
  if (input.enabled || input.identifier) return;
  throw new SyslogNodeError(
    "ANTIFRAUD_IDENTIFIER",
    input.identifierCleared ? ANTIFRAUD_KEEPS_IDENTIFIER : ANTIFRAUD_NEEDS_IDENTIFIER,
  );
}

export async function listSyslogNodes(): Promise<SyslogNode[]> {
  return prisma.smgSyslogNode.findMany({
    orderBy: { name: "asc" },
    select: nodeSelect,
  });
}

export async function syslogNodeExists(ip: string): Promise<boolean> {
  return (await findSyslogNode(ip)) != null;
}

export async function findSyslogNode(ip: string): Promise<SyslogNode | null> {
  const canonical = canonicalIpv4(ip);
  if (!canonical) return null;
  return prisma.smgSyslogNode.findUnique({
    where: { ip: canonical },
    select: nodeSelect,
  });
}

export async function setSyslogEnabled(input: {
  enabled: boolean;
  actorUserId: string;
  ip: string | null;
}): Promise<boolean> {
  await prisma.appSetting.update({
    where: { id: 1 },
    data: { syslogEnabled: input.enabled },
  });
  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.SMG_SYSLOG_ENABLE,
    entityType: "app_settings",
    entityId: "1",
    ip: input.ip,
    meta: { enabled: input.enabled },
  });
  return input.enabled;
}

export async function readSyslogEnabled(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { syslogEnabled: true },
  });
  return row?.syslogEnabled ?? false;
}

export async function addSyslogNode(input: {
  ip: string;
  name: string;
  identifier: string;
  cdrTimezone?: string;
  antifraudEnabled?: boolean;
  actorUserId: string;
  requestIp: string | null;
}): Promise<SyslogNode> {
  const ip = cleanIp(input.ip);
  const name = cleanName(input.name);
  const identifier = cleanIdentifier(input.identifier, true);
  const cdrTimezone = cleanCdrTimezone(input.cdrTimezone ?? "UTC");
  const antifraudEnabled = input.antifraudEnabled ?? true;
  assertAntifraudIdentifier({
    enabled: antifraudEnabled,
    identifier,
    identifierCleared: false,
  });
  try {
    const row = await prisma.smgSyslogNode.create({
      data: { ip, name, identifier, cdrTimezone, antifraudEnabled },
      select: nodeSelect,
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_ADD,
      entityType: "smg_syslog_node",
      entityId: row.ip,
      ip: input.requestIp,
      meta: {
        ip: row.ip,
        name: row.name,
        identifier: row.identifier,
        cdrTimezone: row.cdrTimezone,
        antifraudEnabled: row.antifraudEnabled,
      },
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SyslogNodeError("DUPLICATE", duplicateFieldMessage(error.meta?.target));
    }
    throw error;
  }
}

export async function renameSyslogNode(input: {
  ip: string;
  name: string;
  identifier?: string;
  cdrTimezone?: string;
  antifraudEnabled?: boolean;
  actorUserId: string;
  requestIp: string | null;
}): Promise<SyslogNode> {
  const ip = cleanIp(input.ip);
  const name = cleanName(input.name);
  const identifier =
    input.identifier === undefined ? undefined : cleanIdentifier(input.identifier, false);
  const cdrTimezone =
    input.cdrTimezone === undefined ? undefined : cleanCdrTimezone(input.cdrTimezone);
  const existing = await prisma.smgSyslogNode.findUnique({
    where: { ip },
    select: nodeSelect,
  });
  if (!existing) throw new SyslogNodeError("NOT_FOUND", "Узел не найден");
  const antifraudEnabled =
    input.antifraudEnabled === undefined
      ? existing.antifraudEnabled
      : input.antifraudEnabled;
  const nextIdentifier = identifier === undefined ? existing.identifier : identifier;
  assertAntifraudIdentifier({
    enabled: antifraudEnabled,
    identifier: nextIdentifier,
    identifierCleared: identifier === null,
  });
  try {
    const row = await prisma.smgSyslogNode.update({
      where: { ip },
      data: {
        name,
        ...(identifier !== undefined ? { identifier } : {}),
        ...(cdrTimezone !== undefined ? { cdrTimezone } : {}),
        ...(input.antifraudEnabled !== undefined ? { antifraudEnabled } : {}),
      },
      select: nodeSelect,
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_RENAME,
      entityType: "smg_syslog_node",
      entityId: row.ip,
      ip: input.requestIp,
      meta: {
        ip: row.ip,
        name: row.name,
        identifier: row.identifier,
        cdrTimezone: row.cdrTimezone,
        antifraudEnabled: row.antifraudEnabled,
        previousName: existing.name,
        previousIdentifier: existing.identifier,
        previousCdrTimezone: existing.cdrTimezone,
        previousAntifraudEnabled: existing.antifraudEnabled,
      },
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SyslogNodeError("DUPLICATE", duplicateFieldMessage(error.meta?.target));
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new SyslogNodeError("NOT_FOUND", "Узел не найден");
    }
    throw error;
  }
}

export async function deleteSyslogNode(ip: string): Promise<SyslogNode> {
  const canonical = cleanIp(ip);
  const existing = await prisma.smgSyslogNode.findUnique({
    where: { ip: canonical },
    select: nodeSelect,
  });
  if (!existing) throw new SyslogNodeError("NOT_FOUND", "Узел не найден");
  await prisma.smgSyslogNode.delete({ where: { ip: canonical } });
  return existing;
}
