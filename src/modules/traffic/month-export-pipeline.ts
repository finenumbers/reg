import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { Prisma } from "@/generated/prisma/client";
import { chunkArray } from "@/lib/chunk";
import { prisma } from "@/lib/db";
import { formatCount } from "@/lib/format-count";
import { formatExportTimestamp } from "@/lib/format-display-time";
import { logger } from "@/lib/logger";
import { cdrMonthPrefix } from "@/lib/month-window";
import { parseMonthKey } from "@/modules/traffic/cdr-month";
import { EXCEL_MAX_ROWS, type ResolvedEnrichedRow } from "@/modules/enrich/types";
import { writeResolvedEnrichedXlsx } from "@/modules/enrich/xlsx-writer";
import { getEnrichReadyFlags } from "@/modules/pstn/credentials";
import { loadCdrImportEnrichment } from "@/modules/traffic/enrich-import";
import {
  applyPatchToRow,
  collectGapKeys,
  mergeEnrichGaps,
  type StoredEnrichRow,
} from "@/modules/traffic/month-export-gaps";
import {
  getMonthExportById,
  markMonthExportFailed,
  patchMonthExportJob,
  setMonthExportStage,
} from "@/modules/traffic/month-export-job";
import {
  formatMonthGenitive,
  monthExportJobTitle,
  monthExportSheetName,
} from "@/modules/traffic/month-labels";
import { syncCdrAtFromCdrDate } from "@/modules/traffic/sync-cdr-at";
import {
  ensureMonthExportJobDir,
  monthExportJsonlPath,
  monthExportOutputPath,
} from "@/modules/traffic/month-export-paths";
import {
  elapsedMsToSeconds,
  MONTH_EXPORT_PAGE_SIZE,
  MONTH_EXPORT_PROGRESS_MS,
  MONTH_EXPORT_UPDATE_BATCH,
  type MonthExportStageView,
} from "@/modules/traffic/month-export-types";

const CDR_SELECT = {
  id: true,
  cdrId: true,
  cdrDate: true,
  billAni: true,
  billDnis: true,
  elapsedTime: true,
  srcName: true,
  dstName: true,
  dpName: true,
  disconnectCodeString: true,
  remoteSrcSigAddress: true,
  remoteDstSigAddress: true,
  sideA: true,
  operatorA: true,
  geographyA: true,
  sideB: true,
  operatorB: true,
  geographyB: true,
  countryA: true,
  cityA: true,
  providerA: true,
  countryB: true,
  cityB: true,
  providerB: true,
  enrichedAt: true,
} satisfies Prisma.CdrRecordSelect;

type CdrExportRow = Prisma.CdrRecordGetPayload<{ select: typeof CDR_SELECT }>;

export function windowWhere(
  year: number,
  month: number,
  importedAt: Date,
): Prisma.CdrRecordWhereInput {
  return {
    cdrDate: { startsWith: cdrMonthPrefix(year, month) },
    importedAt: { lte: importedAt },
  };
}

function keysetAfter(
  lastDate: string,
  lastId: string,
): Prisma.CdrRecordWhereInput {
  return {
    OR: [
      { cdrDate: { gt: lastDate } },
      { AND: [{ cdrDate: lastDate }, { cdrId: { gt: lastId } }] },
    ],
  };
}

function toStored(row: CdrExportRow): StoredEnrichRow {
  return {
    billAni: row.billAni,
    billDnis: row.billDnis,
    remoteSrcSigAddress: row.remoteSrcSigAddress,
    remoteDstSigAddress: row.remoteDstSigAddress,
    sideA: row.sideA,
    operatorA: row.operatorA,
    geographyA: row.geographyA,
    sideB: row.sideB,
    operatorB: row.operatorB,
    geographyB: row.geographyB,
    countryA: row.countryA,
    cityA: row.cityA,
    providerA: row.providerA,
    countryB: row.countryB,
    cityB: row.cityB,
    providerB: row.providerB,
    enrichedAt: row.enrichedAt,
  };
}

function toResolved(row: CdrExportRow, stored: StoredEnrichRow): ResolvedEnrichedRow {
  return {
    time: row.cdrDate,
    aNumber: stored.billAni,
    bNumber: stored.billDnis,
    seconds: elapsedMsToSeconds(row.elapsedTime),
    initDevice: row.srcName,
    termDevice: row.dstName,
    dialObject: row.dpName,
    cause: row.disconnectCodeString,
    initEndpoint: row.remoteSrcSigAddress,
    termEndpoint: row.remoteDstSigAddress,
    sideA: stored.sideA,
    sideB: stored.sideB,
    operatorA: stored.operatorA,
    geographyA: stored.geographyA,
    operatorB: stored.operatorB,
    geographyB: stored.geographyB,
    countryA: stored.countryA,
    cityA: stored.cityA,
    providerA: stored.providerA,
    countryB: stored.countryB,
    cityB: stored.cityB,
    providerB: stored.providerB,
  };
}

export async function runMonthExportPipeline(jobId: string): Promise<void> {
  let stages: MonthExportStageView[] = [];
  let lastPersist = 0;
  const persist = (next: MonthExportStageView[], force = false) => {
    stages = next;
    const now = Date.now();
    if (!force && now - lastPersist < MONTH_EXPORT_PROGRESS_MS) return;
    lastPersist = now;
    patchMonthExportJob(jobId, { stages });
  };

  try {
    patchMonthExportJob(jobId, { status: "running" });
    const jobStartedAt = new Date();
    const existing = getMonthExportById(jobId);
    if (!existing) {
      throw new Error("Задача выгрузки не найдена");
    }
    const parsed = parseMonthKey(existing.month);
    if (!parsed) {
      throw new Error("Некорректный месяц выгрузки");
    }

    stages = setMonthExportStage(
      existing.stages.map((stage) => ({ ...stage })),
      "period",
      { status: "running" },
    );
    persist(stages, true);

    await syncCdrAtFromCdrDate();
    const title = monthExportJobTitle(parsed.year, parsed.month);
    const trafficSheetName = monthExportSheetName(parsed.year, parsed.month);
    const filename = `${trafficSheetName}-${formatExportTimestamp(jobStartedAt, "UTC")}.xlsx`;
    patchMonthExportJob(jobId, { title, trafficSheetName, filename });

    stages = setMonthExportStage(stages, "period", {
      status: "done",
      detail: trafficSheetName,
    });
    persist(stages, true);

    const where = windowWhere(parsed.year, parsed.month, jobStartedAt);
    const total = await prisma.cdrRecord.count({ where });
    if (total > EXCEL_MAX_ROWS) {
      throw new Error(
        `Слишком много строк (${formatCount(total)}). Максимум листа Excel — ${formatCount(EXCEL_MAX_ROWS)}`,
      );
    }
    if (total === 0) {
      const month = formatMonthGenitive(parsed.year, parsed.month);
      throw new Error(`Нет звонков за ${month}`);
    }

    stages = setMonthExportStage(stages, "read", {
      status: "running",
      current: 0,
      total,
    });
    stages = setMonthExportStage(stages, "fill", { status: "running" });
    persist(stages, true);

    ensureMonthExportJobDir(jobId);
    const jsonlPath = monthExportJsonlPath(jobId);
    const outputPath = monthExportOutputPath(jobId);
    const stream = createWriteStream(jsonlPath, { encoding: "utf8" });

    let processed = 0;
    let gapRows = 0;
    let pstnCacheHits = 0;
    let pstnLive = 0;
    let geoCacheHits = 0;
    let geoLive = 0;
    let cursorDate: string | undefined;
    let cursorCdrId: string | undefined;

    while (true) {
      const pageWhere: Prisma.CdrRecordWhereInput =
        cursorDate && cursorCdrId
          ? { AND: [where, keysetAfter(cursorDate, cursorCdrId)] }
          : where;
      const page = await prisma.cdrRecord.findMany({
        where: pageWhere,
        orderBy: [{ cdrDate: "asc" }, { cdrId: "asc" }],
        take: MONTH_EXPORT_PAGE_SIZE,
        select: CDR_SELECT,
      });
      if (page.length === 0) break;
      const last = page[page.length - 1]!;
      cursorDate = last.cdrDate;
      cursorCdrId = last.cdrId;

      const phones = new Set<string>();
      const ips = new Set<string>();
      const storedRows = page.map((row) => ({ row, stored: toStored(row) }));
      for (const item of storedRows) {
        const keys = collectGapKeys(item.stored);
        if (keys.phones.length > 0 || keys.ips.length > 0) gapRows += 1;
        for (const phone of keys.phones) phones.add(phone);
        for (const ip of keys.ips) ips.add(ip);
      }

      const maps =
        phones.size > 0 || ips.size > 0
          ? await loadCdrImportEnrichment([...phones], [...ips])
          : null;
      if (maps) {
        pstnCacheHits += maps.stats.pstnCacheHits;
        pstnLive += maps.stats.pstnLiveLookups;
        geoCacheHits += maps.stats.geoCacheHits;
        geoLive += maps.stats.geoLiveLookups;
      }

      const pendingUpdates: Array<{
        id: string;
        data: ReturnType<typeof mergeEnrichGaps>["patch"];
      }> = [];
      for (const item of storedRows) {
        let stored = item.stored;
        if (maps) {
          const { patch, changed } = mergeEnrichGaps(stored, maps);
          if (changed) {
            stored = applyPatchToRow(stored, patch);
            pendingUpdates.push({ id: item.row.id, data: patch });
          }
        }
        stream.write(`${JSON.stringify(toResolved(item.row, stored))}\n`);
        processed += 1;
      }
      for (const batch of chunkArray(pendingUpdates, MONTH_EXPORT_UPDATE_BATCH)) {
        await prisma.$transaction(
          batch.map((item) =>
            prisma.cdrRecord.update({
              where: { id: item.id },
              data: item.data,
            }),
          ),
        );
      }

      stages = setMonthExportStage(stages, "read", {
        status: "running",
        current: processed,
        total,
        detail: `дыр: ${formatCount(gapRows)}`,
      });
      if (maps) {
        stages = setMonthExportStage(stages, "fill", {
          status: "running",
          detail: `кэш ${formatCount(pstnCacheHits + geoCacheHits)} · API ${formatCount(pstnLive + geoLive)}`,
        });
      }
      persist(stages);
    }

    stream.end();
    await finished(stream);

    stages = setMonthExportStage(stages, "read", {
      status: "done",
      current: processed,
      total,
      detail: `дыр: ${formatCount(gapRows)}`,
    });
    if (gapRows === 0) {
      stages = setMonthExportStage(stages, "fill", {
        status: "done",
        detail: "дыр нет",
      });
    } else {
      const flags = await getEnrichReadyFlags();
      const noKeys = !flags.hasPstnApiKey || !flags.hasGeoipApiKey;
      stages = setMonthExportStage(stages, "fill", {
        status: "done",
        detail: `${noKeys ? "нет ключа API, только кэш · " : ""}кэш ${formatCount(pstnCacheHits + geoCacheHits)} · API ${formatCount(pstnLive + geoLive)}`,
      });
    }
    persist(stages, true);

    stages = setMonthExportStage(stages, "traffic", {
      status: "running",
      label: `Лист «${trafficSheetName}»`,
      current: 0,
      total: processed,
    });
    persist(stages);

    await writeResolvedEnrichedXlsx({
      jsonlPath,
      outputPath,
      rowCount: processed,
      trafficSheetName,
      onProgress: (info) => {
        if (info.sheet === "detail") {
          stages = setMonthExportStage(stages, "traffic", {
            status: "done",
            current: processed,
            total: processed,
            label: `Лист «${trafficSheetName}»`,
          });
          stages = setMonthExportStage(stages, "detail", {
            status: "running",
            current: info.current,
            total: info.total,
          });
        } else {
          stages = setMonthExportStage(stages, "traffic", {
            status: "running",
            current: info.current,
            total: info.total,
            label: `Лист «${trafficSheetName}»`,
          });
        }
        persist(stages);
      },
    });

    stages = setMonthExportStage(stages, "traffic", {
      status: "done",
      current: processed,
      total: processed,
      label: `Лист «${trafficSheetName}»`,
    });
    stages = setMonthExportStage(stages, "detail", {
      status: "done",
      current: processed,
      total: processed,
    });
    stages = setMonthExportStage(stages, "download", { status: "done" });
    persist(stages, true);
    patchMonthExportJob(jobId, { status: "completed" });
    logger.info("traffic.export.completed", {
      jobId,
      rows: processed,
      gaps: gapRows,
      sheet: trafficSheetName,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось сформировать XLSX";
    logger.error("traffic.export.failed", { jobId, error: message });
    markMonthExportFailed(jobId, message);
  }
}
