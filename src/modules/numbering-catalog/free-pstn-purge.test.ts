import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("free PSTN purge", () => {
  it("moves misses in chunks under sync locks and skips an empty snapshot", () => {
    const purge = readFileSync(
      path.join(process.cwd(), "src/modules/numbering-catalog/free-pstn-purge.ts"),
      "utf8",
    );
    const decorate = readFileSync(
      path.join(process.cwd(), "src/modules/numbering-catalog/decorate.ts"),
      "utf8",
    );
    expect(purge).toContain("PURGE_CHUNK = 1000");
    expect(purge).toContain("pstn_hits IN (0, 2)");
    expect(purge).toContain("numbering_free_pstn_excluded");
    expect(purge).toContain("RESPLIT_LOCKS");
    expect(purge).toContain("SELECT 1 AS ok FROM pstn_range_snapshot LIMIT 1");
    expect(purge).toContain("noteCatalogReplaced");
    expect(purge).toContain("throw new SyncBusy()");
    expect(decorate).toContain("await purgeFreePstnMisses()");
  });

  it("clears excluded on every free publish", () => {
    const files = [
      "src/modules/numbering-sync/publish.ts",
      "src/modules/runexis/publish.ts",
      "src/modules/uis/publish.ts",
      "src/modules/exolve/publish.ts",
      "src/modules/voximplant/publish.ts",
      "src/modules/mcn/publish.ts",
      "src/modules/aurora/publish.ts",
      "src/modules/finenumbers/publish.ts",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain("clearFreePstnExcludedSql");
    }
    expect(
      readFileSync(
        path.join(process.cwd(), "src/modules/numbering-sync/one-side.ts"),
        "utf8",
      ),
    ).toContain("clearExcludedSql");
  });

  it("adds the excluded table and partial miss index", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20261122110000_free_pstn_excluded/migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("numbering_free_pstn_excluded");
    expect(migration).toContain("free_numbers_pstn_miss_idx");
    expect(migration).toContain('WHERE "pstn_hits" IN (0, 2)');
  });
});
