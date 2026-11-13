/**
 * Read and replace one numbering-source origin and its token.
 * The saved origin is not requested.
 */

import { prisma } from "@/lib/db";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  freeSourceWrite,
  numberingLoadAuditMeta,
  purchasedSourceWrite,
  type NumberingLoadView,
  type NumberingSourceSaveInput,
} from "@/modules/numbering-load/schemas";
import {
  parseNumberingSourceOrigin,
  NUMBERING_SOURCE_ORIGIN_ERROR,
} from "@/modules/numbering-load/origin";
import {
  getSecretEncryptionService,
  serializeEncryptedSecret,
} from "@/modules/ssh/secrets";

export class NumberingLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NumberingLoadError";
  }
}

const SOURCE_SELECT = {
  freeNumbersSourceBaseUrl: true,
  freeNumbersSourceTokenCiphertext: true,
  purchasedNumbersSourceBaseUrl: true,
  purchasedNumbersSourceTokenCiphertext: true,
} as const;

function emptyView(): NumberingLoadView {
  return {
    free: { baseUrl: null, hasToken: false },
    purchased: { baseUrl: null, hasToken: false },
  };
}

export async function getNumberingLoadView(): Promise<NumberingLoadView> {
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: SOURCE_SELECT,
  });
  if (!row) return emptyView();
  return {
    free: {
      baseUrl: row.freeNumbersSourceBaseUrl,
      hasToken: Boolean(row.freeNumbersSourceTokenCiphertext),
    },
    purchased: {
      baseUrl: row.purchasedNumbersSourceBaseUrl,
      hasToken: Boolean(row.purchasedNumbersSourceTokenCiphertext),
    },
  };
}

function storedOrigin(input: NumberingSourceSaveInput): string | null {
  const parsed = parseNumberingSourceOrigin(input.baseUrl);
  if (!parsed.ok) throw new NumberingLoadError(parsed.error || NUMBERING_SOURCE_ORIGIN_ERROR);
  return parsed.origin;
}

function replacementCiphertext(token: string | undefined): string | null {
  const trimmed = token?.trim() ?? "";
  if (!trimmed) return null;
  return serializeEncryptedSecret(getSecretEncryptionService().encrypt(trimmed));
}

async function writeAudit(
  action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
  actor: { userId: string; ip?: string | null },
  baseUrl: string | null,
  tokenReplaced: boolean,
) {
  await auditService.append({
    actorUserId: actor.userId,
    action,
    entityType: "app_settings",
    entityId: "1",
    ip: actor.ip,
    meta: numberingLoadAuditMeta(baseUrl, tokenReplaced),
  });
}

export async function saveFreeNumberSource(
  input: NumberingSourceSaveInput,
  actor: { userId: string; ip?: string | null },
): Promise<NumberingLoadView> {
  const origin = storedOrigin(input);
  const ciphertext = replacementCiphertext(input.token);
  const data = freeSourceWrite(origin, ciphertext);
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  const view = await getNumberingLoadView();
  await writeAudit(
    AUDIT_ACTIONS.NUMBERING_LOAD_FREE_SAVE,
    actor,
    view.free.baseUrl,
    ciphertext !== null,
  );
  return view;
}

export async function savePurchasedNumberSource(
  input: NumberingSourceSaveInput,
  actor: { userId: string; ip?: string | null },
): Promise<NumberingLoadView> {
  const origin = storedOrigin(input);
  const ciphertext = replacementCiphertext(input.token);
  const data = purchasedSourceWrite(origin, ciphertext);
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  const view = await getNumberingLoadView();
  await writeAudit(
    AUDIT_ACTIONS.NUMBERING_LOAD_PURCHASED_SAVE,
    actor,
    view.purchased.baseUrl,
    ciphertext !== null,
  );
  return view;
}
