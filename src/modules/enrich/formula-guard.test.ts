import { describe, expect, it } from "vitest";
import { guardExcelText } from "@/modules/enrich/formula-guard";

describe("guardExcelText", () => {
  it("prefixes formula-like text", () => {
    expect(guardExcelText("=1+1")).toBe("'=1+1");
    expect(guardExcelText("+cmd")).toBe("'+cmd");
    expect(guardExcelText("-1")).toBe("'-1");
    expect(guardExcelText("@sum")).toBe("'@sum");
  });

  it("leaves ordinary text", () => {
    expect(guardExcelText("TS, 10 - BYE received")).toBe(
      "TS, 10 - BYE received",
    );
    expect(guardExcelText("")).toBe("");
  });
});
