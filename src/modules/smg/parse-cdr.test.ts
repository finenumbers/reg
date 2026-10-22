import { describe, expect, it } from "vitest";
import { SMG_COLUMNS } from "@/modules/smg/columns";
import { decodeSmgBytes, parseSmgText } from "@/modules/smg/parse-cdr";

const BANNER = "SMG1016M. CDR. File started at '20261013120000'";

function headerLine(kind: "short" | "full"): string {
  const columns = kind === "short" ? SMG_COLUMNS.slice(0, 50) : SMG_COLUMNS;
  return `${columns.map((column) => column.header).join(";")};`;
}

function dataLine(
  kind: "short" | "full",
  patch: Record<string, string>,
  width?: number,
): string {
  const columns = kind === "short" ? SMG_COLUMNS.slice(0, 50) : SMG_COLUMNS;
  const values = columns.map((column) => patch[column.field] ?? "");
  const used = width == null ? values : values.slice(0, width);
  return `${used.join(";")};`;
}

const CALL = {
  deviceSign: "mts",
  setupTime: "2026-10-13 11:59:00",
  disconnectTime: "2026-10-13 12:00:00",
  uniqueTag: "tag-1",
  incomingCgpn: "79001112233",
};

describe("parseSmgText", () => {
  it("reads a short file and leaves the full-only columns empty", () => {
    const text = [BANNER, headerLine("short"), dataLine("short", CALL)].join("\n");
    const parsed = parseSmgText(text, "20261013.cdr");
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.deviceSign).toBe("mts");
    expect(parsed.rows[0]?.fields.timeInQueue).toBe("");
    expect(parsed.rows[0]?.fields.redirectionType).toBe("");
    expect(parsed.rows[0]?.disconnectDay).toBe("2026-10-13");
  });

  it("pads a full row whose last field collapsed into the terminator", () => {
    const text = [
      BANNER,
      headerLine("full"),
      dataLine(
        "full",
        { ...CALL, deviceSign: "kazan", uniqueTag: "aa bb", timeInQueue: "0" },
        51,
      ),
    ].join("\n");
    const parsed = parseSmgText(text, "20261013120000.cdr");
    expect(parsed.error).toBeNull();
    expect(parsed.rows[0]?.fields.uniqueTag).toBe("aa bb");
    expect(parsed.rows[0]?.fields.timeInQueue).toBe("0");
    expect(parsed.rows[0]?.fields.redirectionType).toBe("");
    expect(parsed.rows[0]?.recordKey.startsWith("kazan\u001faa bb")).toBe(true);
  });

  it("keeps a call whose device sign is blank", () => {
    const text = [
      BANNER,
      headerLine("short"),
      dataLine("short", CALL),
      dataLine("short", { ...CALL, deviceSign: "", uniqueTag: "tag-2" }),
    ].join("\n");
    const parsed = parseSmgText(text, "20261013.cdr");
    expect(parsed.error).toBeNull();
    expect(parsed.linesBad).toBe(0);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]?.fields.deviceSign).toBe("");
    expect(parsed.rows[1]?.recordKey.startsWith("\u001ftag-2")).toBe(true);
  });

  it("still rejects a blank node that has no call identity", () => {
    const text = [
      BANNER,
      headerLine("short"),
      dataLine("short", {
        ...CALL,
        deviceSign: "",
        uniqueTag: "",
        sequenceNumber: "",
      }),
    ].join("\n");
    const parsed = parseSmgText(text, "20261013.cdr");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.linesBad).toBe(1);
    expect(parsed.error).toMatch(/нет идентификатора вызова/);
  });

  it("collapses a repeated call identity inside one file", () => {
    const text = [
      BANNER,
      headerLine("short"),
      dataLine("short", CALL),
      dataLine("short", { ...CALL, incomingCgpn: "79009998877" }),
    ].join("\n");
    const parsed = parseSmgText(text, "20261013.cdr");
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.incomingCgpn).toBe("79001112233");
  });

  it("rejects a row shorter than the header by more than one field", () => {
    const text = [
      BANNER,
      headerLine("full"),
      dataLine("full", CALL),
      dataLine("full", { ...CALL, uniqueTag: "tag-2" }, 45),
    ].join("\n");
    const parsed = parseSmgText(text, "20261013120000.cdr");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.uniqueTag).toBe("tag-1");
    expect(parsed.linesBad).toBe(1);
    expect(parsed.error).toMatch(/строка 4/);
    expect(parsed.error).toMatch(/строка короче заголовка/);
  });

  it("rejects an unknown header without rows", () => {
    const parsed = parseSmgText(`${BANNER}\nNope;\n`, "20261013.cdr");
    expect(parsed.rows).toEqual([]);
    expect(parsed.error).toMatch(/неизвестный заголовок/);
  });

  it("ignores a repeated header on an otherwise empty file", () => {
    const header = headerLine("full");
    const parsed = parseSmgText(
      [BANNER, header, "", header].join("\n"),
      "20261013172246.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([]);
    expect(parsed.linesBad).toBe(0);
  });

  it("keeps a call that follows a repeated header", () => {
    const header = headerLine("full");
    const parsed = parseSmgText(
      [BANNER, header, "", header, dataLine("full", CALL)].join("\n"),
      "20261013172246.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.deviceSign).toBe("mts");
  });

  it("still rejects a call whose disconnect time is not a timestamp", () => {
    const parsed = parseSmgText(
      [
        BANNER,
        headerLine("full"),
        dataLine("full", { ...CALL, disconnectTime: "Disconnect time" }),
      ].join("\n"),
      "20261013172246.cdr",
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.linesBad).toBe(1);
    expect(parsed.error).toMatch(/строка 3/);
    expect(parsed.error).toMatch(/нераспознано время разъединения/);
  });

  it("accepts two banners and two headers with no calls", () => {
    const header = headerLine("full");
    const parsed = parseSmgText(
      [BANNER, header, "SMG1016M. CDR. File started at '20261014161854'", header].join(
        "\n",
      ),
      "20261014161954.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([]);
    expect(parsed.linesBad).toBe(0);
  });

  it("keeps calls before and after a second banner", () => {
    const header = headerLine("full");
    const parsed = parseSmgText(
      [
        BANNER,
        header,
        dataLine("full", CALL),
        "SMG1016M. CDR. File started at '20261014161854'",
        header,
        dataLine("full", { ...CALL, uniqueTag: "tag-2", incomingCgpn: "79009998877" }),
      ].join("\n"),
      "20261014161954.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.fields.incomingCgpn).toBe("79001112233");
    expect(parsed.rows[1]?.fields.uniqueTag).toBe("tag-2");
    expect(parsed.rows[1]?.fields.incomingCgpn).toBe("79009998877");
  });

  it("reads a call that follows a second banner without a new header", () => {
    const parsed = parseSmgText(
      [
        BANNER,
        headerLine("full"),
        "SMG1016M. CDR. File started at '20261014161854'",
        dataLine("full", { ...CALL, timeInQueue: "4" }),
      ].join("\n"),
      "20261014161954.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.timeInQueue).toBe("4");
  });

  it("switches from a full header to a short header", () => {
    const parsed = parseSmgText(
      [
        BANNER,
        headerLine("full"),
        "SMG1016M. CDR. File started at '20261014161854'",
        headerLine("short"),
        dataLine("short", CALL),
      ].join("\n"),
      "20261014161954.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.incomingCgpn).toBe("79001112233");
    expect(parsed.rows[0]?.fields.timeInQueue).toBe("");
    expect(parsed.rows[0]?.fields.redirectionType).toBe("");
  });

  it("switches from a short header to a full header", () => {
    const parsed = parseSmgText(
      [
        BANNER,
        headerLine("short"),
        "SMG1016M. CDR. File started at '20261014161854'",
        headerLine("full"),
        dataLine("full", { ...CALL, timeInQueue: "7", redirectionType: "cfu" }),
      ].join("\n"),
      "20261014161954.cdr",
    );
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.fields.incomingCgpn).toBe("79001112233");
    expect(parsed.rows[0]?.fields.timeInQueue).toBe("7");
    expect(parsed.rows[0]?.fields.redirectionType).toBe("cfu");
  });

  it("rejects a banner prefix that has trailing text", () => {
    const parsed = parseSmgText(
      [
        BANNER,
        headerLine("full"),
        "SMG1016M. CDR. File started at '20261014161854' extra",
      ].join("\n"),
      "20261014161954.cdr",
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.linesBad).toBe(1);
    expect(parsed.error).toMatch(/строка 3/);
    expect(parsed.error).toMatch(/строка короче заголовка/);
  });

  it("accepts a header-only file", () => {
    const parsed = parseSmgText(`${BANNER}\n${headerLine("short")}\n`, "20261013.cdr");
    expect(parsed.rows).toEqual([]);
    expect(parsed.error).toBeNull();
  });

  it("decodes windows-1251 when the bytes are not UTF-8", () => {
    expect(decodeSmgBytes(Uint8Array.from([0xc0]))).toBe("А");
  });
});
