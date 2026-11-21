import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  parsedAlignAction,
  parsedAlignSql,
  parsedPassName,
  parsedView,
  type ParsedViewInput,
} from "@/modules/numbering-catalog/parsed-pass";

function sqlValues(sql: Prisma.Sql): unknown[] {
  const found: unknown[] = [];
  for (const value of sql.values) {
    if (value instanceof Prisma.Sql) found.push(...sqlValues(value));
    else found.push(value);
  }
  return found;
}

function flattenSql(sql: Prisma.Sql): string {
  const text: string[] = [];
  for (let i = 0; i < sql.strings.length; i++) {
    text.push(sql.strings[i] ?? "");
    const value = sql.values[i];
    if (value instanceof Prisma.Sql) text.push(flattenSql(value));
    else if (i < sql.values.length) text.push("?");
  }
  return text.join("");
}

const cursor = {
  cursorPhase: "free",
  cursorEpoch: 4,
  cursorProvider: "",
  parsedPass: "mask:4",
};

function align(over: Partial<Parameters<typeof parsedAlignAction>[0]> = {}) {
  return parsedAlignAction({
    phase: "free",
    epoch: 4,
    provider: "",
    afterId: "row-9",
    ...cursor,
    purchasedOnly: false,
    ...over,
  });
}

function view(over: Partial<ParsedViewInput> = {}): ParsedViewInput {
  return {
    resplitEpoch: 1,
    resplitDone: 1,
    maskEpoch: 4,
    maskDone: 3,
    providers: [
      { name: "SipOut", epoch: 1, done: 1 },
      { name: "MCN Telecom", epoch: 2, done: 2 },
    ],
    cursorPhase: "free",
    cursorAfter: "row-9",
    cursorEpoch: 4,
    cursorProvider: "",
    parsedPass: "mask:4",
    ...over,
  };
}

describe("parsed pass", () => {
  it("names a mask side and a provider side separately", () => {
    expect(parsedPassName("free", 4, "")).toBe("mask:free:4");
    expect(parsedPassName("purchased", 4, "")).toBe("mask:purchased:4");
    expect(parsedPassName("provider-free", 2, "MCN Telecom")).toBe(
      "provider:MCN Telecom:free:2",
    );
    expect(parsedPassName("provider-purchased", 2, "MCN Telecom")).toBe(
      "provider:MCN Telecom:purchased:2",
    );
    expect(parsedPassName("resplit-free", 4, "")).toBeNull();
    expect(parsedPassName("provider-free", 2, "Other")).toBeNull();
  });

  it("replaces an old mask counter with the rows at the cursor", () => {
    expect(align()).toEqual({
      kind: "replace",
      pass: "mask:free:4",
      table: "free_numbers",
      afterId: "row-9",
    });
    expect(align({ afterId: "" })).toEqual({ kind: "zero", pass: "mask:free:4" });
    expect(
      align({ parsedPass: "mask:free:4", cursorPhase: "free", afterId: "row-9" }),
    ).toEqual({ kind: "keep" });
  });

  it("keeps the free totals when the purchased side starts", () => {
    expect(
      align({
        phase: "purchased",
        afterId: "",
        parsedPass: "mask:free:4",
        cursorPhase: "free",
      }),
    ).toEqual({ kind: "rename", pass: "mask:purchased:4" });
    expect(
      align({
        phase: "purchased",
        afterId: "",
        parsedPass: "mask:purchased:4",
        cursorPhase: "free",
      }),
    ).toEqual({ kind: "keep" });
    expect(
      align({
        phase: "purchased",
        afterId: "row-2",
        parsedPass: "mask:free:4",
        cursorPhase: "purchased",
      }),
    ).toEqual({
      kind: "add",
      pass: "mask:purchased:4",
      table: "purchased_numbers",
      afterId: "row-2",
    });
    expect(
      align({
        phase: "provider-purchased",
        epoch: 2,
        provider: "MCN Telecom",
        afterId: "",
        parsedPass: "",
        cursorPhase: "",
        cursorEpoch: 0,
        cursorProvider: "",
        purchasedOnly: true,
      }),
    ).toEqual({ kind: "zero", pass: "provider:MCN Telecom:purchased:2" });
  });

  it("zeros a side whose cursor jumped home", () => {
    expect(align({ forceZero: true, parsedPass: "mask:free:4" })).toEqual({
      kind: "zero",
      pass: "mask:free:4",
    });
  });

  it("counts the open mask from the cursor while the pass name is old", () => {
    expect(parsedView(view())).toEqual({
      kind: "count",
      table: "free_numbers",
      after: "row-9",
      provider: null,
    });
    expect(parsedView(view({ parsedPass: "mask:free:4" }))).toEqual({ kind: "stored" });
    expect(parsedView(view({ cursorAfter: "" }))).toEqual({ kind: "zero" });
    expect(parsedView(view({ resplitEpoch: 5, resplitDone: 4 }))).toEqual({
      kind: "zero",
    });
    expect(
      parsedView(
        view({
          maskEpoch: 4,
          maskDone: 4,
          providers: [{ name: "MCN Telecom", epoch: 8, done: 7 }],
          cursorPhase: "provider-free",
          cursorEpoch: 8,
          cursorProvider: "MCN Telecom",
          parsedPass: "provider:MCN Telecom:8",
        }),
      ),
    ).toEqual({
      kind: "count",
      table: "free_numbers",
      after: "row-9",
      provider: "MCN Telecom",
    });
  });

  it("writes one provider and does not scan on a rename", () => {
    const replace = parsedAlignSql(
      { kind: "replace", pass: "mask:free:4", table: "free_numbers", afterId: "row-9" },
      { phase: "free", epoch: 4, provider: "", seenPass: "mask:4" },
    );
    expect(replace).not.toBeNull();
    if (!replace) return;
    const text = flattenSql(replace);
    expect(text).toContain("id <=");
    expect(text).toContain("GROUP BY provider");
    expect(text).toContain("sipout_parsed");
    expect(text).toContain("mcn_parsed");
    expect(text).not.toContain("free_numbers_provider");
    expect(sqlValues(replace)).toContain("row-9");
    expect(sqlValues(replace)).toContain("mask:free:4");

    const one = parsedAlignSql(
      {
        kind: "replace",
        pass: "provider:MCN Telecom:free:2",
        table: "free_numbers",
        afterId: "row-9",
      },
      {
        phase: "provider-free",
        epoch: 2,
        provider: "MCN Telecom",
        seenPass: "provider:MCN Telecom:2",
      },
    );
    expect(one).not.toBeNull();
    if (!one) return;
    const oneText = flattenSql(one);
    expect(oneText).toContain("mcn_parsed");
    expect(oneText).toContain("mcn_epoch");
    expect(oneText).not.toContain("sipout_parsed");
    expect(oneText).not.toContain("GROUP BY provider");

    const rename = parsedAlignSql(
      { kind: "rename", pass: "mask:purchased:4" },
      { phase: "purchased", epoch: 4, provider: "", seenPass: "mask:free:4" },
    );
    expect(rename).not.toBeNull();
    if (!rename) return;
    const renameText = flattenSql(rename);
    expect(renameText).toContain("parsed_pass");
    expect(renameText).not.toContain("free_numbers");
    expect(renameText).not.toContain("id <=");
  });
});
