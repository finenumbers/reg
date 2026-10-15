import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { duplicateFieldMessage, parseIdentifier } from "@/modules/smg-syslog/identifier";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";

const NAME_MAX = 64;
const BAD_IDENTIFIER =
  "Идентификатор: латинская буква, затем буквы, цифры или _, до 32 символов";

export type SyslogNode = {
  ip: string;
  name: string;
  identifier: string | null;
};

const nodeSelect = { ip: true, name: true, identifier: true } as const;

export class SyslogNodeError extends Error {
  constructor(
    readonly code: "BAD_IP" | "BAD_NAME" | "BAD_IDENTIFIER" | "DUPLICATE" | "NOT_FOUND",
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

export async function listSyslogNodes(): Promise<SyslogNode[]> {
  return prisma.smgSyslogNode.findMany({
    orderBy: { name: "asc" },
    select: nodeSelect,
  });
}

export async function syslogNodeExists(ip: string): Promise<boolean> {
  const canonical = canonicalIpv4(ip);
  if (!canonical) return false;
  const row = await prisma.smgSyslogNode.findUnique({
    where: { ip: canonical },
    select: { ip: true },
  });
  return row != null;
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
  actorUserId: string;
  requestIp: string | null;
}): Promise<SyslogNode> {
  const ip = cleanIp(input.ip);
  const name = cleanName(input.name);
  const identifier = cleanIdentifier(input.identifier, true);
  try {
    const row = await prisma.smgSyslogNode.create({
      data: { ip, name, identifier },
      select: nodeSelect,
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_ADD,
      entityType: "smg_syslog_node",
      entityId: row.ip,
      ip: input.requestIp,
      meta: { ip: row.ip, name: row.name, identifier: row.identifier },
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
  actorUserId: string;
  requestIp: string | null;
}): Promise<SyslogNode> {
  const ip = cleanIp(input.ip);
  const name = cleanName(input.name);
  const identifier =
    input.identifier === undefined ? undefined : cleanIdentifier(input.identifier, false);
  const existing = await prisma.smgSyslogNode.findUnique({
    where: { ip },
    select: nodeSelect,
  });
  if (!existing) throw new SyslogNodeError("NOT_FOUND", "Узел не найден");
  try {
    const row = await prisma.smgSyslogNode.update({
      where: { ip },
      data: { name, ...(identifier !== undefined ? { identifier } : {}) },
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
        previousName: existing.name,
        previousIdentifier: existing.identifier,
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

export async function deleteSyslogNode(input: {
  ip: string;
  actorUserId: string;
  requestIp: string | null;
}): Promise<void> {
  const ip = cleanIp(input.ip);
  const existing = await prisma.smgSyslogNode.findUnique({
    where: { ip },
    select: nodeSelect,
  });
  if (!existing) throw new SyslogNodeError("NOT_FOUND", "Узел не найден");
  await prisma.smgSyslogNode.delete({ where: { ip } });
  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_DELETE,
    entityType: "smg_syslog_node",
    entityId: existing.ip,
    ip: input.requestIp,
    meta: { ip: existing.ip, name: existing.name, identifier: existing.identifier },
  });
}
