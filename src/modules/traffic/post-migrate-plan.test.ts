import { describe, expect, it } from "vitest";
import {
  appliedMigrations,
  planPostMigrate,
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
      tariff: true,
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
