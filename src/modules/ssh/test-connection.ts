/**
 * SSH connection test orchestration (Phase 3).
 *
 * Scope: connectivity + authentication + session establishment only.
 * Does NOT run check_regs.sh / regs.poll and does NOT update reg_current.
 * Allowlisted remote exec for business polling lands in Phase 4.
 */

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { sshClient } from "@/modules/ssh/client";
import { SshTestError } from "@/modules/ssh/errors";
import {
  deserializeEncryptedSecret,
  getSecretEncryptionService,
} from "@/modules/ssh/secrets";
import type { SshTestResult } from "@/generated/prisma/client";

export type SshConnectionTestView = {
  id: string;
  result: SshTestResult;
  detail: string | null;
  durationMs: number | null;
  profileId: string;
  createdAt: Date;
};

export async function runSshConnectionTest(actor: {
  userId: string;
  ip?: string | null;
}): Promise<SshConnectionTestView> {
  const settings = await prisma.appSetting.findUnique({
    where: { id: 1 },
    include: { activeSshProfile: true },
  });

  const profile = settings?.activeSshProfile;
  if (!profile) {
    throw new SshTestError(
      "PROFILE_INCOMPLETE",
      "No active SSH profile configured — save host/port/username first",
    );
  }
  if (!profile.host || !profile.username) {
    throw new SshTestError(
      "PROFILE_INCOMPLETE",
      "SSH profile is incomplete — host and username are required",
    );
  }
  if (!profile.privateKeyCiphertext) {
    throw new SshTestError(
      "NO_PRIVATE_KEY",
      "No private key on file — import a .ppk or PEM/OpenSSH key first",
    );
  }

  let privateKeyPem: string;
  try {
    const envelope = deserializeEncryptedSecret(profile.privateKeyCiphertext);
    privateKeyPem = getSecretEncryptionService().decrypt(envelope);
  } catch {
    throw new SshTestError(
      "DECRYPT_FAILED",
      "Stored private key could not be decrypted — re-import the key",
    );
  }

  const started = Date.now();
  const outcome = await sshClient.testConnection(
    {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      privateKeyPem,
    },
    15_000,
  );

  // Drop plaintext reference as soon as possible (GC assist).
  privateKeyPem = "";

  const durationMs = outcome.durationMs || Date.now() - started;
  const result = outcome.result as SshTestResult;

  const record = await prisma.sshConnectionTest.create({
    data: {
      profileId: profile.id,
      actorUserId: actor.userId,
      result,
      detail: outcome.detail,
      exitCode: null,
      parsedCount: null,
    },
  });

  await auditService.append({
    actorUserId: actor.userId,
    action: AUDIT_ACTIONS.SSH_TEST,
    entityType: "ssh_connection_test",
    entityId: record.id,
    ip: actor.ip,
    meta: {
      profileId: profile.id,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      result,
      detail: outcome.detail,
      durationMs,
      // Explicit: auth/session only — no remote script exec
      mode: "auth_session_only",
    },
  });

  return {
    id: record.id,
    result: record.result,
    detail: record.detail,
    durationMs,
    profileId: record.profileId,
    createdAt: record.createdAt,
  };
}
