import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatCount } from "@/lib/format-count";
import { formatExportTimestamp } from "@/lib/format-display-time";
import { logger } from "@/lib/logger";
import { monthWindow, type MonthPeriod } from "@/lib/month-window";
import { EXCEL_MAX_ROWS, type ResolvedEnrichedRow } from "@/modules/enrich/types";
import { writeResolvedEnrichedXlsx } from "@/modules/enrich/xlsx-writer";
import { getEnrichReadyFlags } from "@/modules/pstn/credentials";
import { getDisplayTimezone } from "@/modules/settings";
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
  monthExportButtonLabel,
  monthExportSheetName,
} from "@/modules/traffic/month-labels";
import {
  ensureMonthExportJobDir,
  monthExportJsonlPath,
  monthExportOutputPath,
} from "@/modules/traffic/month-export-paths";
import {
  elapsedMsToSeconds,
  MONTH_EXPORT_PAGE_SIZE,
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

function windowWhere(
  period: MonthPeriod,
  start: Date,
  end: Date,
  importedAt: Date,
): Prisma.CdrRecordWhereInput {
  const cdrAt =
    period === "previous"
      ? { gte: start, lt: end }
      : { gte: start, lte: end };
  return {
    cdrAt,
    importedAt: { lte: importedAt },
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
  const persist = (next: MonthExportStageView[]) => {
    stages = next;
    patchMonthExportJob(jobId, { stages });
  };

  try {
    patchMonthExportJob(jobId, { status: "running" });
    const jobStartedAt = new Date();
    const timeZone = await getDisplayTimezone();
    const existing = getMonthExportById(jobId);
    if (!existing) {
      throw new Error("Задача выгрузки не найдена");
    }
    const periodValue = existing.period;

    stages = setMonthExportStage(
      existing.stages.map((stage) => ({ ...stage })),
      "period",
      { status: "running" },
    );
    persist(stages);

    const win = monthWindow(periodValue, timeZone, jobStartedAt);
    const title = monthExportButtonLabel(periodValue, win.year, win.month);
    const trafficSheetName = monthExportSheetName(periodValue, win.year, win.month);
    const filename = `${trafficSheetName}-${formatExportTimestamp(jobStartedAt, timeZone)}.xlsx`;
    patchMonthExportJob(jobId, { title, trafficSheetName, filename });

    stages = setMonthExportStage(stages, "period", {
      status: "done",
      detail: `${trafficSheetName} · ${timeZone}`,
    });
    persist(stages);

    const where = windowWhere(periodValue, win.start, win.end, jobStartedAt);
    const total = await prisma.cdrRecord.count({ where });
    if (total > EXCEL_MAX_ROWS) {
      throw new Error(
        `Слишком много строк (${formatCount(total)}). Максимум листа Excel — ${formatCount(EXCEL_MAX_ROWS)}`,
      );
    }

    stages = setMonthExportStage(stages, "read", {
      status: "running",
      current: 0,
      total,
    });
    stages = setMonthExportStage(stages, "fill", { status: "running" });
    persist(stages);

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
    let cursorCdrId: string | undefined;

    while (true) {
      const page = await prisma.cdrRecord.findMany({
        where,
        orderBy: [{ cdrAt: "asc" }, { cdrId: "asc" }],
        take: MONTH_EXPORT_PAGE_SIZE,
        ...(cursorCdrId
          ? { cursor: { cdrId: cursorCdrId }, skip: 1 }
          : {}),
        select: CDR_SELECT,
      });
      if (page.length === 0) break;
      cursorCdrId = page[page.length - 1]!.cdrId;

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

      for (const item of storedRows) {
        let stored = item.stored;
        if (maps) {
          const { patch, changed } = mergeEnrichGaps(stored, maps);
          if (changed) {
            stored = applyPatchToRow(stored, patch);
            await prisma.cdrRecord.update({
              where: { id: item.row.id },
              data: patch,
            });
          }
        }
        stream.write(`${JSON.stringify(toResolved(item.row, stored))}\n`);
        processed += 1;
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
      detail:
        total === 0
          ? "нет записей — будут только заголовки"
          : `дыр: ${formatCount(gapRows)}`,
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
    persist(stages);

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
    persist(stages);
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
