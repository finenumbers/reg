import { describe, expect, it } from "vitest";
import { splitQuotedSemicolon } from "@/modules/enrich/parse-csv";
import { billableMinutes, stripIpPort } from "@/modules/enrich/types";

describe("CDR CSV parser", () => {
  it("splits quoted semicolon fields", () => {
    expect(splitQuotedSemicolon('"a";"b;c";"d"')).toEqual(["a", "b;c", "d"]);
    expect(splitQuotedSemicolon('"a""b";"c"')).toEqual(['a"b', "c"]);
  });
});

describe("billable minutes", () => {
  it("ceils to full minutes", () => {
    expect(billableMinutes(0)).toBe(0);
    expect(billableMinutes(1)).toBe(0);
    expect(billableMinutes(3)).toBe(0);
    expect(billableMinutes(4)).toBe(1);
    expect(billableMinutes(22)).toBe(1);
    expect(billableMinutes(60)).toBe(1);
    expect(billableMinutes(61)).toBe(2);
  });
});

describe("stripIpPort", () => {
  it("drops the port", () => {
    expect(stripIpPort("5.227.161.181:5190")).toBe("5.227.161.181");
    expect(stripIpPort("")).toBeNull();
  });
});
