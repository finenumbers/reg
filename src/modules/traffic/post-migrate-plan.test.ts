import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appliedMigrations,
  LABEL_FREE_MIGRATIONS,
  LABEL_REWRITING_MIGRATIONS,
  planPostMigrate,
  TARIFF_BLOCKING_MIGRATIONS,
} from "../../../scripts/cdr-post-migrate.mjs";

const QUIET = "No pending migrations to apply.\n";
const DIAL = "Applying migration `20261020220000_dial_exceptions`\n";
const CLOSED = "Applying migration `20261020190000_closed_dial_prefixes`\n";
const LABEL = "Applying migration `20261007160000_cdr_call_category_labels`\n";

describe("planPostMigrate", () => {
  it("does not read the journal when the schema is already current", () => {
    expect(appliedMigrations(QUIET)).toEqual([]);
    expect(planPostMigrate(QUIET, { rateGeneration: 4, ratedGeneration: 3 })).toEqual({
      callClass: false,
      tariff: false,
    });
  });

  it("leaves a generation gap to the app job", () => {
    expect(planPostMigrate(DIAL, { rateGeneration: 5, ratedGeneration: 4 })).toEqual({
      callClass: false,
      tariff: false,
    });
    expect(
      planPostMigrate(`${CLOSED}\n${DIAL}`, { rateGeneration: 1, ratedGeneration: 0 }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("keeps the blocking tariff pass when a migration did not move the generation", () => {
    expect(planPostMigrate(CLOSED, { rateGeneration: 2, ratedGeneration: 2 })).toEqual({
      callClass: false,
      tariff: true,
    });
    expect(planPostMigrate(CLOSED, null)).toEqual({ callClass: false, tariff: true });
  });

  it("rewrites leftover labels only when such a migration was applied", () => {
    expect(planPostMigrate(LABEL, { rateGeneration: 1, ratedGeneration: 0 })).toEqual({
      callClass: true,
      tariff: false,
    });
    expect(
      planPostMigrate(`${LABEL}\n${DIAL}`, { rateGeneration: 3, ratedGeneration: 3 }),
    ).toEqual({
      callClass: true,
      tariff: false,
    });
  });

  it("does not scan the journal when purchased provider prices are added", () => {
    expect(
      planPostMigrate(
        "Applying migration `20261118210000_purchased_provider_prices`\n",
        { rateGeneration: 4, ratedGeneration: 4 },
      ),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the enrich upload table is dropped", () => {
    expect(
      planPostMigrate("Applying migration `20261031180000_drop_enrich_jobs`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when tariff numbering is added", () => {
    expect(
      planPostMigrate("Applying migration `20261107123000_tariff_numbering`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when tariff region is added", () => {
    expect(
      planPostMigrate("Applying migration `20261107161000_tariff_region`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when number masks are added", () => {
    expect(
      planPostMigrate("Applying migration `20261109120000_number_masks`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when marking labels are added", () => {
    expect(
      planPostMigrate("Applying migration `20261113143000_marking_labels`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the marking working set is indexed", () => {
    expect(
      planPostMigrate("Applying migration `20261113170000_marking_working_set`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the free-number catalog is added", () => {
    expect(
      planPostMigrate("Applying migration `20261114001000_free_numbers`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when purchased numbers are added", () => {
    expect(
      planPostMigrate("Applying migration `20261114020000_purchased_numbers`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the SipOut lease is created", () => {
    expect(
      planPostMigrate("Applying migration `20261114040000_sipout_sync`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when UIS stores its key and lease", () => {
    expect(
      planPostMigrate("Applying migration `20261115140000_uis_source`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when catalog money columns are renamed", () => {
    expect(
      planPostMigrate("Applying migration `20261116010000_catalog_sale_columns`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when catalog category columns are dropped", () => {
    expect(
      planPostMigrate("Applying migration `20261117210000_drop_catalog_category`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the RTP leg index columns are added", () => {
    expect(
      planPostMigrate("Applying migration `20261118160000_rtp_leg_index`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when a provider decorate epoch is added", () => {
    expect(
      planPostMigrate("Applying migration `20261116020000_catalog_decorate_epoch`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when Runexis stores both catalogs", () => {
    expect(
      planPostMigrate("Applying migration `20261115120000_runexis_catalogs`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when Runexis stores its free-number lease", () => {
    expect(
      planPostMigrate("Applying migration `20261114150000_runexis_free`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when a SipOut stage stores both catalogs", () => {
    expect(
      planPostMigrate("Applying migration `20261114053000_sipout_source_stage`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when marking supplier is copied", () => {
    expect(
      planPostMigrate("Applying migration `20261113193000_marking_supplier`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when a mask hyphen is ignored", () => {
    expect(
      planPostMigrate("Applying migration `20261113120000_mask_hyphen`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the RTU screen stores mask cells", () => {
    expect(
      planPostMigrate("Applying migration `20261113043000_rtu_screen_masks`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when mask columns are reordered", () => {
    expect(
      planPostMigrate("Applying migration `20261113003000_number_masks_column_order`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when geography DID sources are added", () => {
    expect(
      planPostMigrate("Applying migration `20261107190000_geography_did_source`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal when the mobile screen ABC is completed", () => {
    expect(
      planPostMigrate("Applying migration `20261107170000_geography_mobile_abc`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("does not scan the journal for the syslog label migration", () => {
    expect(
      planPostMigrate("Applying migration `20261021021000_smg_trace_labels`\n", {
        rateGeneration: 4,
        ratedGeneration: 4,
      }),
    ).toEqual({ callClass: false, tariff: false });
  });

  it("skips a listed tariff migration once the generation is already ahead", () => {
    expect(planPostMigrate(CLOSED, { rateGeneration: 3, ratedGeneration: 2 })).toEqual({
      callClass: false,
      tariff: false,
    });
  });

  it("keeps both passes when the log does not say what was applied", () => {
    expect(
      planPostMigrate("All migrations have been successfully applied.\n", null),
    ).toEqual({
      callClass: true,
      tariff: true,
    });
  });
});

/**
 * Every migration after the last one the lists were written against must say
 * how it touches stored CDR labels. A new migration with no entry fails here
 * instead of starting a full cdr_records scan on the next deploy without a decision.
 */
const CLASSIFIED_FROM = "20261021021000_smg_trace_labels";
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../prisma/migrations", import.meta.url));
const LABEL_REWRITE_SQL = [
  /\bUPDATE\s+"?cdr_records"?\b/i,
  /\bcdr_call_(category|status|type)\b/i,
];

function migrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => name > CLASSIFIED_FROM)
    .sort();
}

describe("migration classification guard", () => {
  it("classifies every migration newer than the last reviewed one", () => {
    const unclassified = migrationFolders().filter(
      (name) =>
        !LABEL_FREE_MIGRATIONS.has(name) &&
        !TARIFF_BLOCKING_MIGRATIONS.has(name) &&
        !LABEL_REWRITING_MIGRATIONS.has(name),
    );
    expect(unclassified).toEqual([]);
  });

  it("never lists a label-free migration that rewrites CDR labels", () => {
    const rewriting = migrationFolders()
      .filter((name) => LABEL_FREE_MIGRATIONS.has(name))
      .filter((name) => {
        const sql = readFileSync(`${MIGRATIONS_DIR}/${name}/migration.sql`, "utf8")
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("--"))
          .join("\n");
        return LABEL_REWRITE_SQL.some((pattern) => pattern.test(sql));
      });
    expect(rewriting).toEqual([]);
  });
});
