import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { canonicalIpv4 } from "@/modules/smg-syslog/ip";

const NAME_MAX = 64;

export type SyslogNode = {
  ip: string;
  name: string;
};

export class SyslogNodeError extends Error {
  constructor(
    readonly code: "BAD_IP" | "BAD_NAME" | "DUPLICATE" | "NOT_FOUND",
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
    throw new SyslogNodeError("BAD_NAME", "Название узла не может содержать перевод строки");
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

export async function listSyslogNodes(): Promise<SyslogNode[]> {
  const rows = await prisma.smgSyslogNode.findMany({
    orderBy: { name: "asc" },
    select: { ip: true, name: true },
  });
  return rows;
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
  actorUserId: string;
  requestIp: string | null;
}): Promise<SyslogNode> {
  const ip = cleanIp(input.ip);
  const name = cleanName(input.name);
  try {
    const row = await prisma.smgSyslogNode.create({
      data: { ip, name },
      select: { ip: true, name: true },
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_ADD,
      entityType: "smg_syslog_node",
      entityId: row.ip,
      ip: input.requestIp,
      meta: { ip: row.ip, name: row.name },
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SyslogNodeError("DUPLICATE", "Такой IP или название уже есть");
    }
    throw error;
  }
}

export async function renameSyslogNode(input: {
  ip: string;
  name: string;
  actorUserId: string;
  requestIp: string | null;
}): Promise<SyslogNode> {
  const ip = cleanIp(input.ip);
  const name = cleanName(input.name);
  try {
    const row = await prisma.smgSyslogNode.update({
      where: { ip },
      data: { name },
      select: { ip: true, name: true },
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_RENAME,
      entityType: "smg_syslog_node",
      entityId: row.ip,
      ip: input.requestIp,
      meta: { ip: row.ip, name: row.name },
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SyslogNodeError("DUPLICATE", "Такое название уже есть");
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
    select: { ip: true, name: true },
  });
  if (!existing) throw new SyslogNodeError("NOT_FOUND", "Узел не найден");
  await prisma.smgSyslogNode.delete({ where: { ip } });
  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.SMG_SYSLOG_NODE_DELETE,
    entityType: "smg_syslog_node",
    entityId: existing.ip,
    ip: input.requestIp,
    meta: { ip: existing.ip, name: existing.name },
  });
}
