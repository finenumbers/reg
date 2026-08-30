import { formatCount } from "@/lib/format-count";
import { logger } from "@/lib/logger";
import { AUDIT_ACTIONS, auditService } from "@/modules/audit";
import {
  INITIAL_STAGES,
  MISSING_PSTN_LABEL,
  type EnrichStageView,
  type EnrichSummary,
} from "@/modules/enrich/types";
import { asMissPhrase } from "@/modules/enrich/summary-format";
import { parseCsvToJsonl } from "@/modules/enrich/parse-csv";
import {
  enrichGeoIps,
  enrichPstnPhones,
  loadDescriptionsForPhones,
} from "@/modules/enrich/lookups";
import { writeEnrichedXlsx } from "@/modules/enrich/xlsx-writer";
import {
  enrichJsonlPath,
  enrichOutputPath,
  enrichSourcePath,
  enrichedDownloadName,
} from "@/modules/enrich/paths";
import { patchJob, setStage } from "@/modules/enrich/jobs";

export async function runEnrichPipeline(input: {
  jobId: string;
  actorUserId: string;
  sourceFilename: string;
  ip?: string | null;
}): Promise<void> {
  const { jobId } = input;
  let stages: EnrichStageView[] = INITIAL_STAGES.map((s) => ({ ...s }));

  const persist = async (
    patch: Parameters<typeof patchJob>[1],
  ) => {
    await patchJob(jobId, patch);
  };

  try {
    await persist({
      status: "running",
      startedAt: new Date(),
      stages: setStage(stages, "parse", { status: "running" }),
    });
    stages = setStage(stages, "parse", { status: "running" });

    const parsed = await parseCsvToJsonl(
      enrichSourcePath(jobId),
      enrichJsonlPath(jobId),
    );
    stages = setStage(stages, "parse", {
      status: "done",
      current: parsed.rows,
      total: parsed.rows,
      ...(parsed.badLines > 0
        ? { detail: `пропущено ${formatCount(parsed.badLines)}` }
        : {}),
    });
    await persist({ stages, throttle: false });

    stages = setStage(stages, "phones", { status: "running" });
    await persist({ stages });
    const descriptions = await loadDescriptionsForPhones(parsed.uniquePhones);
    let descriptionFound = 0;
    for (const phone of parsed.uniquePhones) {
      if (descriptions.get(phone)?.trim()) descriptionFound += 1;
    }
    stages = setStage(stages, "phones", {
      status: "done",
      current: parsed.uniquePhones.length,
      total: parsed.uniquePhones.length,
      detail: `найдено ${formatCount(descriptionFound)} из ${formatCount(parsed.uniquePhones.length)}`,
    });
    await persist({ stages });

    stages = setStage(stages, "pstn", { status: "running" });
    await persist({ stages });
    const pstn = await enrichPstnPhones(parsed.uniquePhones, (p) => {
      stages = setStage(stages, "pstn", {
        status: "running",
        current: p.current,
        total: p.total,
      });
      void persist({ stages, throttle: true });
    });
    stages = setStage(stages, "pstn", {
      status: "done",
      current: parsed.uniquePhones.length,
      total: parsed.uniquePhones.length,
      detail: `найдено ${formatCount(pstn.found)}, ${asMissPhrase(MISSING_PSTN_LABEL)} ${formatCount(pstn.missing)}`,
    });
    await persist({ stages });

    stages = setStage(stages, "geoip", { status: "running" });
    await persist({ stages });
    const geo = await enrichGeoIps(parsed.uniqueIps, (p) => {
      stages = setStage(stages, "geoip", {
        status: "running",
        current: p.current,
        total: p.total,
      });
      void persist({ stages, throttle: true });
    });
    stages = setStage(stages, "geoip", {
      status: "done",
      current: parsed.uniqueIps.length,
      total: parsed.uniqueIps.length,
      detail: `${formatCount(geo.lookedUp)} IP`,
    });
    await persist({ stages });

    stages = setStage(stages, "xlsx", { status: "running" });
    await persist({ stages });
    await writeEnrichedXlsx({
      jsonlPath: enrichJsonlPath(jobId),
      outputPath: enrichOutputPath(jobId),
      rowCount: parsed.rows,
      descriptions,
      pstn: pstn.byOriginal,
      geo: geo.byIp,
    });
    stages = setStage(stages, "xlsx", { status: "done" });
    stages = setStage(stages, "download", { status: "done" });

    const outputFilename = enrichedDownloadName(input.sourceFilename);
    const summary: EnrichSummary = {
      rows: parsed.rows,
      badLines: parsed.badLines,
      uniquePhones: parsed.uniquePhones.length,
      uniqueIps: parsed.uniqueIps.length,
      descriptionFound,
      descriptionMissing: parsed.uniquePhones.length - descriptionFound,
      pstnFound: pstn.found,
      pstnMissing: pstn.missing,
      pstnCacheHits: pstn.cacheHits,
      pstnLiveLookups: pstn.liveLookups,
      geoipLookedUp: geo.lookedUp,
      geoipCacheHits: geo.cacheHits,
      geoipLiveLookups: geo.liveLookups,
      outputFilename,
    };

    await persist({
      status: "completed",
      stages,
      summary,
      finishedAt: new Date(),
      errorMessage: null,
    });

    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.ENRICH_FINISH,
      entityType: "enrich_job",
      entityId: jobId,
      ip: input.ip,
      meta: {
        status: "completed",
        rows: summary.rows,
        uniquePhones: summary.uniquePhones,
        uniqueIps: summary.uniqueIps,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Ошибка обогащения";
    logger.error("enrich.pipeline_failed", { jobId, error: message });
    const failed = stages.map((stage) =>
      stage.status === "running"
        ? { ...stage, status: "error" as const, detail: message }
        : stage,
    );
    await persist({
      status: "failed",
      stages: failed,
      errorMessage: message,
      finishedAt: new Date(),
    });
    await auditService.append({
      actorUserId: input.actorUserId,
      action: AUDIT_ACTIONS.ENRICH_FINISH,
      entityType: "enrich_job",
      entityId: jobId,
      ip: input.ip,
      meta: { status: "failed" },
    });
  }
}
