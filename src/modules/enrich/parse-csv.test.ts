import { describe, expect, it } from "vitest";
import {
  parseCdrLine,
  splitQuotedSemicolon,
} from "@/modules/enrich/parse-csv";
import { billableMinutes, stripIpPort } from "@/modules/enrich/types";

describe("CDR CSV parser", () => {
  it("splits quoted semicolon fields", () => {
    expect(splitQuotedSemicolon('"a";"b;c";"d"')).toEqual(["a", "b;c", "d"]);
    expect(splitQuotedSemicolon('"a""b";"c"')).toEqual(['a"b', "c"]);
  });

  it("parses a 10-column CDR line", () => {
    const row = parseCdrLine(
      '"2026-08-01 00:00:19";"79505765234";"73843222200";"22";"PSTN_X";"Fine";"Fine-epdp";"TS, 10 - BYE received";"5.227.161.181:5190";"95.163.183.222:5060"',
    );
    expect(row).toMatchObject({
      time: "2026-08-01 00:00:19",
      aNumber: "79505765234",
      bNumber: "73843222200",
      seconds: 22,
      initIp: "5.227.161.181",
      termIp: "95.163.183.222",
    });
  });

  it("rejects wrong column count", () => {
    expect(parseCdrLine('"a";"b"')).toBeNull();
  });
});

describe("billable minutes", () => {
  it("ceils to full minutes", () => {
    expect(billableMinutes(0)).toBe(0);
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
