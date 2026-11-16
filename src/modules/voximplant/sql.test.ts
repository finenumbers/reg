import { Prisma } from "@/generated/prisma/client";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeLogLine } from "@/modules/voximplant/log";
import { RECLAIM_STAGE_SQL, RECLAIM_STATE_SQL } from "@/modules/voximplant/reclaim";
import {
  DELETE_VOXIMPLANT_FREE_SQL,
  DELETE_VOXIMPLANT_PURCHASED_SQL,
  FREE_COPY_SQL,
  PURCHASED_COPY_SQL,
  VOXIMPLANT_PROVIDER,
  decidePublish,
  dropOverlapSql,
  fillSplitSql,
} from "@/modules/voximplant/sql";
import { VOXIMPLANT_EPOCH_SQL } from "@/modules/numbering-catalog/decorate";

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
  const dir = path.join(process.cwd(), "src/modules/voximplant");
  return readdirSync(dir)
    .filter(
      (name) =>
        !name.endsWith(".test.ts") && (name.endsWith(".ts") || name.endsWith(".tsx")),
    )
    .map((name) => readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

describe("Voximplant catalog SQL", () => {
  it("replaces only the Voximplant slice and leaves purchased money empty", () => {
    expect(VOXIMPLANT_PROVIDER).toBe("Voximplant");
    expect(DELETE_VOXIMPLANT_FREE_SQL).toContain("provider = 'Voximplant'");
    expect(DELETE_VOXIMPLANT_PURCHASED_SQL).toContain("provider = 'Voximplant'");
    expect(FREE_COPY_SQL).toContain("incoming_purchase");
    expect(FREE_COPY_SQL).toContain("incoming_period");
    expect(PURCHASED_COPY_SQL).not.toContain("incoming_purchase");
    expect(PURCHASED_COPY_SQL).toContain("''");
    expect(FREE_COPY_SQL).not.toContain("ON CONFLICT");
    expect(PURCHASED_COPY_SQL).not.toContain("ON CONFLICT");
    expect(FREE_COPY_SQL).not.toContain("rtu_mask_lookup");
    expect(PURCHASED_COPY_SQL).not.toContain("cdr_tariff_geo");
    expect(flattenSql(fillSplitSql("run", 2000))).toContain("voximplant_sync_stage");
    expect(flattenSql(dropOverlapSql("run"))).toContain("catalog = 'free'");
    expect(flattenSql(dropOverlapSql("run"))).toContain("catalog = 'purchased'");
    expect(
      decidePublish({
        held: true,
        stagedFree: 0,
        insertedFree: 0,
        stagedPurchased: 1,
        insertedPurchased: 1,
      }),
    ).toBe("commit");
    const publish = readFileSync(
      path.join(process.cwd(), "src/modules/voximplant/publish.ts"),
      "utf8",
    );
    expect(publish.lastIndexOf("VOXIMPLANT_EPOCH_SQL")).toBeGreaterThan(0);
    expect(publish.lastIndexOf("VOXIMPLANT_EPOCH_SQL")).toBeLessThan(
      publish.indexOf('"COMMIT"'),
    );
    expect(VOXIMPLANT_EPOCH_SQL).toContain("voximplant_epoch");
  });

  it("drops the lease without touching catalogs", () => {
    const text = `${RECLAIM_STATE_SQL}\n${RECLAIM_STAGE_SQL}`;
    expect(text).toContain("voximplant_sync_state");
    expect(text).toContain("DELETE FROM voximplant_sync_stage");
    expect(text).not.toContain("free_numbers");
    expect(text).not.toContain("purchased_numbers");
  });

  it("strips a secret and a phone number from the stage log", () => {
    expect(sanitizeLogLine("Bearer secret-key")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("private_key=abc")).toBe("Площадка отклонила запрос.");
    expect(
      sanitizeLogLine("https://api.voximplant.com/platform_api/GetPhoneNumbers"),
    ).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("номер 74951234567")).toBe("Площадка отклонила запрос.");
    expect(sanitizeLogLine("GetPhoneNumbers offset=0 status=200 attempts=1")).toBe(
      "GetPhoneNumbers offset=0 status=200 attempts=1",
    );
  });

  it("does not name a write or another method", () => {
    const text = sourceText();
    for (const name of [
      "GetAccountInfo",
      "GetPhoneNumberCountryStates",
      "GetPhoneNumbersAsync",
      "AttachPhoneNumber",
      "BindPhoneNumber",
      "DeactivatePhoneNumber",
      "SetPhoneNumberInfo",
      "child_account_id",
      "phone_number_mask",
    ]) {
      expect(text).not.toContain(name);
    }
  });
});
