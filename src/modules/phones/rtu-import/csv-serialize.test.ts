import { describe, expect, it } from "vitest";
import { serializeRtuCsv } from "@/modules/phones/rtu-import/csv-serialize";

describe("serializeRtuCsv", () => {
  it("uses CRLF, quotes headers, leaves \\N and ТЕРМ. Зона unquoted, appends trailing \\N on data rows only", () => {
    const csv = serializeRtuCsv(
      ["Название", "ТЕРМ. Зона", "Порт"],
      [
        ["gw1", "external", "5060"],
        ["ep1", "", "\\N"],
      ],
    );

    expect(csv).toBe(
      [
        '"Название";"ТЕРМ. Зона";"Порт"',
        '"gw1";external;"5060";\\N',
        '"ep1";;\\N;\\N',
        "",
      ].join("\r\n"),
    );
    expect(csv.includes("\n") && !csv.includes("\r\n")).toBe(false);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.startsWith('"Название"')).toBe(true);
  });

  it("quotes ТЕРМ. Зона when the value contains a semicolon", () => {
    const csv = serializeRtuCsv(["ТЕРМ. Зона"], [["a;b"]]);
    expect(csv.split("\r\n")[1]).toBe('"a;b";\\N');
  });
});
