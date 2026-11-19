import { Prisma } from "@/generated/prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogEpochSql } from "@/modules/numbering-catalog/decorate";
import { sanitizeLogLine } from "@/modules/mcn/log";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/mcn/reclaim";
import {
  DELETE_MCN_FREE_SQL,
  DELETE_MCN_PURCHASED_SQL,
  FREE_COPY_SQL,
  MCN_PROVIDER,
  PURCHASED_COPY_SQL,
  fillSplitSql,
} from "@/modules/mcn/sql";

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  for (let i = 0; i < sql.strings.length; i++) {
    text.push(sql.strings[i] ?? "");
    const value = sql.values[i];
    if (value instanceof Prisma.Sql) text.push(flattenSql(value));
    else if (typeof value === "string") text.push(value);
  }
  return text.join("");
}

function sourceText(): string {
  const dir = path.join(process.cwd(), "src/modules/mcn");
  return readdirSync(dir, { recursive: true })
    .flatMap((name) => (typeof name === "string" ? [name] : []))
    .filter(
      (name) =>
        !name.endsWith(".test.ts") && (name.endsWith(".ts") || name.endsWith(".tsx")),
    )
    .map((name) => readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

describe("MCN Telecom catalog SQL", () => {
  it("replaces only the MCN Telecom slice and leaves purchased money empty", () => {
    expect(MCN_PROVIDER).toBe("MCN Telecom");
    expect(DELETE_MCN_FREE_SQL).toContain("provider = 'MCN Telecom'");
    expect(DELETE_MCN_PURCHASED_SQL).toContain("provider = 'MCN Telecom'");
    expect(FREE_COPY_SQL).toContain("incoming_purchase");
    expect(FREE_COPY_SQL).toContain("incoming_period");
    expect(PURCHASED_COPY_SQL).not.toContain("incoming_purchase");
    expect(PURCHASED_COPY_SQL).toContain("''");
    expect(FREE_COPY_SQL).not.toContain("ON CONFLICT");
    expect(PURCHASED_COPY_SQL).not.toContain("ON CONFLICT");
    expect(FREE_COPY_SQL).not.toContain("rtu_mask_lookup");
    expect(PURCHASED_COPY_SQL).not.toContain("cdr_tariff_geo");
    expect(flattenSql(fillSplitSql("run", 2000))).toContain("mcn_sync_stage");
    const publish = readFileSync(
      path.join(process.cwd(), "src/modules/mcn/publish.ts"),
      "utf8",
    );
    const purchasedAt = publish.indexOf("export function replaceMcnPurchased");
    const freeAt = publish.indexOf("export function replaceMcnFree");
    expect(purchasedAt).toBeGreaterThan(0);
    expect(freeAt).toBeGreaterThan(purchasedAt);
    const purchasedFn = publish.slice(purchasedAt, freeAt);
    const freeFn = publish.slice(freeAt);
    expect(purchasedFn).toContain("DELETE_MCN_PURCHASED_SQL");
    expect(purchasedFn).not.toContain("DELETE_MCN_FREE_SQL");
    expect(freeFn).toContain("DELETE_MCN_FREE_SQL");
    expect(freeFn).not.toContain("DELETE_MCN_PURCHASED_SQL");
    expect(publish).toContain("publishOneSide");
    expect(publish).not.toContain("replaceMcnCatalogs");
    expect(publish).not.toContain("dropPurchasedOverlap");
    expect(publish).not.toContain("duplicates_dropped");
    expect(publish).toContain('finishSql("last_purchased_written", "purchased_loaded_at")');
    expect(publish).toContain('finishSql("last_free_written", "free_loaded_at")');
    expect(publish).toContain("${stamp} = CURRENT_TIMESTAMP");
    expect(publish).toContain("last_finished_at = CURRENT_TIMESTAMP");
    expect(publish).toContain('catalogEpochSql("mcn", "purchased")');
    expect(publish).toContain('catalogEpochSql("mcn", "free")');
    const oneSide = readFileSync(
      path.join(process.cwd(), "src/modules/numbering-sync/one-side.ts"),
      "utf8",
    );
    expect(oneSide.indexOf("input.epochSql")).toBeLessThan(oneSide.indexOf('"COMMIT"'));
    expect(catalogEpochSql("mcn", "purchased")).toContain("mcn_epoch");
    const client = readFileSync(
      path.join(process.cwd(), "src/modules/mcn/client.ts"),
      "utf8",
    );
    expect(client).not.toContain("rejectUnauthorized: false");
    expect(client).toContain("Authorization: authorizationHeader(token)");
  });

  it("drops the lease without touching catalogs", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).toContain("mcn_sync_state");
    expect(text).toContain("DELETE FROM mcn_sync_stage");
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
  });

  it("strips a secret and a phone number from the stage log", () => {
    expect(sanitizeLogLine("Bearer secret-key")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("private_key=abc")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("https://shop.mcn.ru/api/protected/showcase/numbers")).toBe(
      "Площадка отклонила запрос.",
    );
    expect(sanitizeLogLine("номер 74951234567")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("numbers country=643 page=1 status=200 attempts=1")).toBe(
      "numbers country=643 page=1 status=200 attempts=1",
    );
  });

  it("does not name another method", () => {
    const text = sourceText();
    for (const name of [
      "geoOnMobile",
      "ndcType",
      "beautyLvl",
      "isShowAllConnectedContractPhones",
      "paidmethods",
      "flashcall",
      "/checkout",
      "/cart",
      "price2",
      "origin_price",
    ]) {
      expect(text).not.toContain(name);
    }
  });
});
