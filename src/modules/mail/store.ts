/**
 * Mail settings on the singleton app_settings row.
 * Saving does not open SMTP. The password column is ciphertext.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";
import {
  mailView,
  planMailSave,
  type MailRow,
  type MailSaveInput,
} from "@/modules/mail/plan";
import type { MailView } from "@/modules/mail/fields";

const mailSelect = {
  smtpHost: true,
  smtpPort: true,
  smtpUsername: true,
  smtpFrom: true,
  smtpRecipients: true,
  smtpPasswordCiphertext: true,
} as const;

function rowOf(
  record: {
    smtpHost: string | null;
    smtpPort: number | null;
    smtpUsername: string | null;
    smtpFrom: string | null;
    smtpRecipients: unknown;
    smtpPasswordCiphertext: string | null;
  } | null,
): MailRow | null {
  if (!record) return null;
  return {
    host: record.smtpHost,
    port: record.smtpPort,
    username: record.smtpUsername,
    from: record.smtpFrom,
    recipients: record.smtpRecipients,
    passwordCiphertext: record.smtpPasswordCiphertext,
  };
}

export async function readMailRow(): Promise<MailRow | null> {
  const record = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: mailSelect,
  });
  return rowOf(record);
}

export async function getMailView(): Promise<MailView> {
  return mailView(await readMailRow());
}

export async function saveMailSettings(
  input: MailSaveInput,
  actor: { userId: string; ip?: string | null },
): Promise<{ ok: true; mail: MailView } | { ok: false; error: string }> {
  const existing = await readMailRow();
  const decision = planMailSave(input, Boolean(existing?.passwordCiphertext));
  if (!decision.ok) return decision;

  if (decision.mode === "clear") {
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {
        smtpHost: null,
        smtpPort: null,
        smtpUsername: null,
        smtpFrom: null,
        smtpRecipients: Prisma.DbNull,
      },
    });
  } else {
    const ciphertext = decision.password
      ? serializeEncryptedSecret(getSecretEncryptionService().encrypt(decision.password))
      : undefined;
    await prisma.appSetting.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        smtpHost: decision.host,
        smtpPort: decision.port,
        smtpUsername: decision.username,
        smtpFrom: decision.from,
        smtpRecipients: decision.recipients,
        ...(ciphertext ? { smtpPasswordCiphertext: ciphertext } : {}),
      },
      update: {
        smtpHost: decision.host,
        smtpPort: decision.port,
        smtpUsername: decision.username,
        smtpFrom: decision.from,
        smtpRecipients: decision.recipients,
        ...(ciphertext ? { smtpPasswordCiphertext: ciphertext } : {}),
      },
    });
  }

  const mail = await getMailView();
  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.MAIL_SAVE,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: {
      host: mail.host || null,
      port: mail.port,
      from: mail.from || null,
      recipients: mail.recipients,
      credentialReplaced: decision.mode === "set" && decision.password !== null,
    },
  });
  return { ok: true, mail };
}

export function decryptMailPassword(ciphertext: string): string {
  return getSecretEncryptionService().decrypt(deserializeEncryptedSecret(ciphertext));
}
