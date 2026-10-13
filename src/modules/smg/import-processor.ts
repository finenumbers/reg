/**
 * Local smg.import — drain the SMG inbox, insert calls, delete only a clean file.
 */

import { readFile, unlink, utimes } from "node:fs/promises";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatCount } from "@/lib/format-count";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { SMG_FILE_SETTLE_MS, SMG_INSERT_BATCH_SIZE } from "@/modules/smg/columns";
import { consumeSmgInboxDirty } from "@/modules/smg/enqueue";
import {
  isSmgCdrFilename,
  listSmgInboxFiles,
  smgInboxFileError,
  type SmgInboxFile,
} from "@/modules/smg/inbox";
import { decodeSmgBytes, parseSmgText } from "@/modules/smg/parse-cdr";
import { clearSmgPoison, markSmgPoisoned } from "@/modules/smg/poison";

export type SmgImportProcessorInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type SmgImportProcessorResult = {
  status: "success" | "failed";
  jobRunId: string;
  phonesParsed: number;
  linesBad: number;
  changesCount: number;
  errorMessage?: string;
  /** Set when a STOR was still open. Enqueue again only after this run leaves inFlight. */
  requeueAfterMs?: number;
};

type FileImportResult = {
  filename: string;
  inserted: number;
  skipped: number;
  linesBad: number;
  error: string | null;
};

async function importOneFile(
  file: SmgInboxFile,
  jobRunId: string,
): Promise<FileImportResult> {
  if (!isSmgCdrFilename(file.filename)) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      error: `Неожиданное имя файла: ${file.filename}`,
    };
  }

  const sizeError = smgInboxFileError(file);
  if (sizeError) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      error: sizeError,
    };
  }

  const bytes = await readFile(file.absPath);
  const parsed = parseSmgText(decodeSmgBytes(bytes), file.filename);
  if (parsed.error && parsed.rows.length === 0) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: parsed.linesBad,
      error: parsed.error,
    };
  }

  let inserted = 0;
  const batch: Prisma.SmgCdrRecordCreateManyInput[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const chunk = batch.splice(0, batch.length);
    const result = await prisma.smgCdrRecord.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += result.count;
  };

  for (const row of parsed.rows) {
    batch.push({
      ...row.fields,
      recordKey: row.recordKey,
      disconnectDay: row.disconnectDay,
      sourceFilename: file.filename,
      lastJobRunId: jobRunId,
    });
    if (batch.length >= SMG_INSERT_BATCH_SIZE) await flush();
  }
  await flush();

  const skipped = Math.max(0, parsed.rows.length - inserted);
  if (parsed.error) {
    return {
      filename: file.filename,
      inserted,
      skipped,
      linesBad: parsed.linesBad,
      error: `Частичная загрузка: вставлено ${formatCount(inserted)} записей, ${formatCount(parsed.linesBad)} битых строк в ${file.filename}. ${parsed.error}`,
    };
  }

  return {
    filename: file.filename,
    inserted,
    skipped,
    linesBad: 0,
    error: null,
  };
}

export async function processSmgImport(
  input: SmgImportProcessorInput,
): Promise<SmgImportProcessorResult> {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "smg.import",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  let phonesParsed = 0;
  let linesBad = 0;
  let changesCount = 0;
  let sawYoung = false;

  try {
    await auditService.append({
      actorUserId: input.actorUserId,
      action:
        input.trigger === "manual"
          ? AUDIT_ACTIONS.SMG_IMPORT_MANUAL
          : AUDIT_ACTIONS.SMG_IMPORT_START,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: { trigger: input.trigger, actionCode: "smg.import", phase: "started" },
    });

    const seen = new Set<string>();
    for (let pass = 0; pass < 16; pass += 1) {
      consumeSmgInboxDirty();
      const { ready, young } = await listSmgInboxFiles();
      if (young.length > 0) sawYoung = true;
      const fresh = ready.filter((file) => !seen.has(`${file.filename}:${file.mtimeMs}`));
      if (fresh.length === 0) {
        if (consumeSmgInboxDirty()) continue;
        break;
      }
      for (const file of fresh) {
        seen.add(`${file.filename}:${file.mtimeMs}`);
        const result = await importOneFile(file, jobRun.id);
        phonesParsed += result.inserted;
        linesBad += result.linesBad;
        changesCount += result.skipped;
        if (result.error) {
          markSmgPoisoned(file.filename, file.mtimeMs, result.error);
          continue;
        }
        clearSmgPoison(file.filename);
        await unlink(file.absPath);
      }
    }

    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "success",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        phonesParsed,
        linesBad,
        changesCount,
      },
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.SMG_IMPORT_FINISH,
      entityType: "job_run",
      entityId: jobRun.id,
      meta: {
        trigger: input.trigger,
        phonesParsed,
        linesBad,
        changesCount,
        phase: "finished",
      },
    });
    logger.info("smg.import.finished", {
      jobRunId: jobRun.id,
      phonesParsed,
      linesBad,
    });
    return {
      status: "success",
      jobRunId: jobRun.id,
      phonesParsed,
      linesBad,
      changesCount,
      requeueAfterMs: sawYoung ? SMG_FILE_SETTLE_MS : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: "failed",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage,
        phonesParsed,
        linesBad,
        changesCount,
      },
    });
    logger.warn("smg.import.failed", { jobRunId: jobRun.id, error: errorMessage });
    return {
      status: "failed",
      jobRunId: jobRun.id,
      phonesParsed,
      linesBad,
      changesCount,
      errorMessage,
      requeueAfterMs: sawYoung ? SMG_FILE_SETTLE_MS : undefined,
    };
  }
}

/** Test helper: age a file past the STOR settle window. */
export async function ageSmgInboxFile(absPath: string): Promise<void> {
  const past = new Date(Date.now() - SMG_FILE_SETTLE_MS - 1_000);
  await utimes(absPath, past, past);
}
