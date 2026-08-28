/**
 * Audit log append — Prisma-backed writes.
 * Listing lives in query.ts; UI formatting in ui-format.ts.
 */

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sanitizeAuditMeta } from "@/modules/audit/sanitize";

export const AUDIT_ACTIONS = {
  AUTH_LOGIN_SUCCESS: "auth.login_success",
  AUTH_LOGIN_FAILURE: "auth.login_failure",
  AUTH_LOGOUT: "auth.logout",
  ADMIN_BOOTSTRAP: "users.admin_bootstrap",
  ROLE_ASSIGN: "users.role_assign",
  SETTINGS_UPDATE: "settings.update",
  SSH_KEY_REPLACE: "ssh.key_replace",
  SSH_TEST: "ssh.test",
  GEOIP_KEY_REPLACE: "geoip.key_replace",
  GEOIP_TEST: "geoip.test",
  PSTN_KEY_REPLACE: "pstn.key_replace",
  PSTN_TEST: "pstn.test",
  ENRICH_START: "enrich.start",
  ENRICH_FINISH: "enrich.finish",
  REGS_POLL_MANUAL: "regs.poll_manual",
  REGS_POLL_START: "regs.poll_start",
  REGS_POLL_FINISH: "regs.poll_finish",
  PHONES_SYNC_MANUAL: "phones.sync_manual",
  PHONES_SYNC_START: "phones.sync_start",
  PHONES_SYNC_FINISH: "phones.sync_finish",
  GROUPS_SYNC_MANUAL: "groups.sync_manual",
  GROUPS_SYNC_START: "groups.sync_start",
  GROUPS_SYNC_FINISH: "groups.sync_finish",
  API_KEY_CREATE: "api_key.create",
  API_KEY_REVOKE: "api_key.revoke",
} as const;

export type AuditAction =
  (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS] | (string & {});

type AuditAppendInput = {
  actorUserId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
};

interface AuditService {
  append(input: AuditAppendInput): Promise<void>;
}

class PrismaAuditService implements AuditService {
  async append(input: AuditAppendInput): Promise<void> {
    try {
      const meta = sanitizeAuditMeta(input.meta);
      await prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          meta: meta as Prisma.InputJsonValue | undefined,
          ip: input.ip ?? null,
        },
      });
    } catch (error) {
      // Never fail the primary request because audit write failed.
      logger.error("audit.append.failed", {
        action: input.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const auditService: AuditService = new PrismaAuditService();
