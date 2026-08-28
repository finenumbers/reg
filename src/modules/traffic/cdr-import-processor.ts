/**
 * Local cdr.import — drain inbox, parse full-dump CSV, insert, delete only on clean success.
 */

import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import { resolveDisplayTimezone } from "@/lib/display-timezone";
import {
  CDR_ENRICH_BACKFILL_MAX_ROWS,
  CDR_INSERT_BATCH_SIZE,
} from "@/modules/traffic/columns";
import {
  inboxFileError,
  listInboxFiles,
  type InboxFile,
} from "@/modules/traffic/inbox";
import { consumeCdrInboxDirty } from "@/modules/traffic/drain-flag";
import { failJobRunIfStillRunning } from "@/modules/jobs/finalize";
import { requestCdrImportDrain } from "@/modules/traffic/enqueue";
import { markPoisoned } from "@/modules/traffic/poison";
import {
  assertCanonicalCdrHeader,
  parseCdrDataLine,
  parseCdrHeaderLine,
} from "@/modules/traffic/parse-cdr";
import {
  addCdrEnrichKeysFromFields,
  backfillUnenrichedCdrRecords,
  createCdrEnrichKeySets,
  enrichFieldsForRow,
  formatCdrEnrichStats,
  loadCdrImportEnrichment,
  rowEnrichmentComplete,
  type CdrEnrichLookupStats,
} from "@/modules/traffic/enrich-import";

export type CdrImportProcessorInput = {
  trigger: "schedule" | "manual" | "test";
  actorUserId?: string;
};

export type CdrImportProcessorResult = {
  status: "success" | "failed";
  jobRunId: string;
  phonesParsed: number;
  linesBad: number;
  changesCount: number;
  errorMessage?: string;
};

type FileImportResult = {
  filename: string;
  inserted: number;
  skipped: number;
  linesBad: number;
  firstBadLine: number | null;
  error: string | null;
  enrichStats: CdrEnrichLookupStats | null;
};

const EMPTY_ENRICH_STATS: CdrEnrichLookupStats = {
  pstnCacheHits: 0,
  pstnLiveLookups: 0,
  geoCacheHits: 0,
  geoLiveLookups: 0,
};

function addEnrichStats(
  into: CdrEnrichLookupStats,
  add: CdrEnrichLookupStats,
): void {
  into.pstnCacheHits += add.pstnCacheHits;
  into.pstnLiveLookups += add.pstnLiveLookups;
  into.geoCacheHits += add.geoCacheHits;
  into.geoLiveLookups += add.geoLiveLookups;
}

function openCdrLines(absPath: string) {
  return createInterface({
    input: createReadStream(absPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
}

function truncateUtf8(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= maxBytes) return value;
  return buf.subarray(0, maxBytes).toString("utf8");
}

async function importOneFile(
  file: InboxFile,
  jobRunId: string,
  timeZone: string,
): Promise<FileImportResult> {
  const sizeError = inboxFileError(file);
  if (sizeError) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      firstBadLine: null,
      error: sizeError,
      enrichStats: null,
    };
  }

  const keys = createCdrEnrichKeySets();
  let lineNo = 0;
  let headerChecked = false;
  let linesBad = 0;
  let firstBadLine: number | null = null;
  let parsedValid = 0;
  let headerError: string | null = null;

  const rl1 = openCdrLines(file.absPath);
  try {
    for await (const raw of rl1) {
      lineNo += 1;
      if (lineNo === 1) {
        try {
          assertCanonicalCdrHeader(parseCdrHeaderLine(raw));
          headerChecked = true;
        } catch (error) {
          headerError =
            error instanceof Error ? error.message : String(error);
          break;
        }
        continue;
      }
      if (!raw.trim()) continue;
      const parsed = parseCdrDataLine(raw, timeZone);
      if (!parsed) {
        linesBad += 1;
        if (firstBadLine == null) firstBadLine = lineNo;
        continue;
      }
      parsedValid += 1;
      addCdrEnrichKeysFromFields(keys, parsed.fields);
    }
  } finally {
    rl1.close();
  }

  if (headerError) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      firstBadLine: 1,
      error: `${file.filename}: ${headerError}`,
      enrichStats: null,
    };
  }

  if (!headerChecked) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      firstBadLine: 1,
      error: `Пустой файл или нет заголовка: ${file.filename}`,
      enrichStats: null,
    };
  }

  // Valid header, no call rows — empty minute, not a failure.
  if (parsedValid === 0 && linesBad === 0) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      firstBadLine: null,
      error: null,
      enrichStats: null,
    };
  }

  if (parsedValid === 0) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad,
      firstBadLine,
      error: `Нет валидных строк в ${file.filename}${firstBadLine ? ` (первая плохая: ${firstBadLine})` : ""}`,
      enrichStats: null,
    };
  }

  const maps = await loadCdrImportEnrichment([...keys.phones], [...keys.ips]);
  logger.info("cdr.import.enrich", {
    filename: file.filename,
    phones: keys.phones.size,
    ips: keys.ips.size,
    ...maps.stats,
  });

  const batch: Prisma.CdrRecordCreateManyInput[] = [];
  let inserted = 0;
  const enrichedAt = new Date();
  const flush = async () => {
    if (batch.length === 0) return;
    const chunk = batch.splice(0, batch.length);
    const result = await prisma.cdrRecord.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    inserted += result.count;
  };

  let insertHeaderError: string | null = null;
  const rl2 = openCdrLines(file.absPath);
  try {
    let n = 0;
    for await (const raw of rl2) {
      n += 1;
      if (n === 1) {
        try {
          assertCanonicalCdrHeader(parseCdrHeaderLine(raw));
        } catch (error) {
          insertHeaderError =
            error instanceof Error ? error.message : String(error);
          break;
        }
        continue;
      }
      if (!raw.trim()) continue;
      const parsed = parseCdrDataLine(raw, timeZone);
      if (!parsed) continue;
      const enrich = enrichFieldsForRow(
        parsed.fields.bill_ani ?? "",
        parsed.fields.bill_dnis ?? "",
        parsed.fields.remote_src_sig_address ?? "",
        parsed.fields.remote_dst_sig_address ?? "",
        maps,
      );
      const complete = rowEnrichmentComplete(
        parsed.fields.bill_ani ?? "",
        parsed.fields.bill_dnis ?? "",
        parsed.fields.remote_src_sig_address ?? "",
        parsed.fields.remote_dst_sig_address ?? "",
        maps,
      );
      batch.push({
        ...(parsed.prisma as Prisma.CdrRecordCreateManyInput),
        ...enrich,
        cdrAt: parsed.cdrAt,
        sourceFilename: file.filename,
        lastJobRunId: jobRunId,
        enrichedAt: complete ? enrichedAt : null,
      });
      if (batch.length >= CDR_INSERT_BATCH_SIZE) {
        await flush();
      }
    }
    if (!insertHeaderError) {
      await flush();
    }
  } finally {
    rl2.close();
  }

  if (insertHeaderError) {
    return {
      filename: file.filename,
      inserted: 0,
      skipped: 0,
      linesBad: 0,
      firstBadLine: 1,
      error: `${file.filename}: ${insertHeaderError}`,
      enrichStats: maps.stats,
    };
  }

  const skipped = Math.max(0, parsedValid - inserted);
  if (linesBad > 0) {
    const first =
      firstBadLine != null ? ` (первая: ${firstBadLine})` : "";
    return {
      filename: file.filename,
      inserted,
      skipped,
      linesBad,
      firstBadLine,
      error: `Частичная загрузка: вставлено ${inserted} записей, ${linesBad} битых строк${first} в ${file.filename}. Файл оставлен в FTP-папке — «Повторить импорт» на Сырых данных.`,
      enrichStats: maps.stats,
    };
  }

  return {
    filename: file.filename,
    inserted,
    skipped,
    linesBad: 0,
    firstBadLine: null,
    error: null,
    enrichStats: maps.stats,
  };
}

export async function processCdrImport(
  input: CdrImportProcessorInput,
): Promise<CdrImportProcessorResult> {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: {
      actionCode: "cdr.import",
      trigger: input.trigger,
      status: "running",
      startedAt,
      actorUserId: input.actorUserId ?? null,
    },
  });

  try {
  await auditService.append({
    actorUserId: input.actorUserId,
    action:
      input.trigger === "manual"
        ? AUDIT_ACTIONS.CDR_IMPORT_MANUAL
        : AUDIT_ACTIONS.CDR_IMPORT_START,
    entityType: "job_run",
    entityId: jobRun.id,
    meta: { trigger: input.trigger, actionCode: "cdr.import", phase: "started" },
  });

  logger.info("cdr.import.started", {
    jobRunId: jobRun.id,
    trigger: input.trigger,
  });

  const tzRow = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { displayTimezone: true },
  });
  const timeZone = resolveDisplayTimezone(tzRow?.displayTimezone);
  const fileResults: FileImportResult[] = [];
  let phonesParsed = 0;
  let linesBad = 0;
  let changesCount = 0;
  const seen = new Set<string>();
  const enrichStats: CdrEnrichLookupStats = { ...EMPTY_ENRICH_STATS };
  let backfilled = 0;
  let backfillRemaining = 0;

  try {
    for (let pass = 0; pass < 16; pass += 1) {
      consumeCdrInboxDirty();
      const files = await listInboxFiles();
      const fresh = files.filter((f) => !seen.has(`${f.filename}:${f.mtimeMs}`));
      if (fresh.length > 0) {
        for (const file of fresh) {
          seen.add(`${file.filename}:${file.mtimeMs}`);
          const result = await importOneFile(file, jobRun.id, timeZone);
          fileResults.push(result);
          phonesParsed += result.inserted;
          linesBad += result.linesBad;
          changesCount += result.skipped;
          if (result.enrichStats) addEnrichStats(enrichStats, result.enrichStats);
          if (result.error) {
            markPoisoned(file.filename, file.mtimeMs, result.error);
          } else {
            await unlink(file.absPath);
          }
        }
        continue;
      }
      if (consumeCdrInboxDirty()) continue;
      const backfill = await backfillUnenrichedCdrRecords({
        maxRows: CDR_ENRICH_BACKFILL_MAX_ROWS,
        shouldAbort: () => consumeCdrInboxDirty(),
      });
      backfilled += backfill.backfilled;
      backfillRemaining = backfill.remaining;
      addEnrichStats(enrichStats, backfill.stats);
      logger.info("cdr.import.backfill", {
        jobRunId: jobRun.id,
        backfilled: backfill.backfilled,
        remaining: backfill.remaining,
        aborted: backfill.aborted,
        ...backfill.stats,
      });
      if (backfill.aborted || consumeCdrInboxDirty()) continue;
      break;
    }
    const leftover = await listInboxFiles();
    if (leftover.length > 0) {
      requestCdrImportDrain("schedule");
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
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
    logger.warn("cdr.import.failed", { jobRunId: jobRun.id, error: errorMessage });
    return {
      status: "failed",
      jobRunId: jobRun.id,
      phonesParsed,
      linesBad,
      changesCount,
      errorMessage,
    };
  }

  const errors = fileResults.filter((r) => r.error).map((r) => r.error!);
  const fileLines = fileResults.map(
    (r) =>
      `${r.filename}: inserted=${r.inserted} skipped=${r.skipped} bad=${r.linesBad}${r.error ? ` error=${r.error}` : ""}`,
  );
  const artifactBody = [
    ...fileLines,
    `backfill: backfilled=${backfilled} remaining=${backfillRemaining}`,
    formatCdrEnrichStats(enrichStats),
  ].join("\n");

  const finishedAt = new Date();
  const failed = errors.length > 0;
  const errorMessage = failed
    ? errors.join(" · ")
    : fileResults.length === 0
      ? null
      : null;

  if (artifactBody) {
    await prisma.jobRunArtifact.upsert({
      where: { jobRunId: jobRun.id },
      create: {
        jobRunId: jobRun.id,
        stdout: truncateUtf8(artifactBody, 200_000),
        stderr: truncateUtf8(errors.join("\n"), 50_000),
      },
      update: {
        stdout: truncateUtf8(artifactBody, 200_000),
        stderr: truncateUtf8(errors.join("\n"), 50_000),
      },
    });
  }

  await prisma.jobRun.update({
    where: { id: jobRun.id },
    data: {
      status: failed ? "failed" : "success",
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage,
      phonesParsed,
      linesBad,
      changesCount,
      meta: {
        files: fileResults.map((r) => r.filename),
        fileCount: fileResults.length,
        backfilled,
        backfillRemaining,
        enrich: enrichStats,
      } as Prisma.InputJsonValue,
    },
  });

  await auditService.append({
    actorUserId: input.actorUserId,
    action: AUDIT_ACTIONS.CDR_IMPORT_FINISH,
    entityType: "job_run",
    entityId: jobRun.id,
    meta: {
      trigger: input.trigger,
      status: failed ? "failed" : "success",
      phonesParsed,
      linesBad,
      changesCount,
      fileCount: fileResults.length,
    },
  });

  logger.info("cdr.import.finished", {
    jobRunId: jobRun.id,
    status: failed ? "failed" : "success",
    phonesParsed,
    linesBad,
    fileCount: fileResults.length,
  });

  return {
    status: failed ? "failed" : "success",
    jobRunId: jobRun.id,
    phonesParsed,
    linesBad,
    changesCount,
    errorMessage: errorMessage ?? undefined,
  };
  } finally {
    await failJobRunIfStillRunning(
      jobRun.id,
      startedAt,
      "Job ended without a terminal status",
    );
  }
}

