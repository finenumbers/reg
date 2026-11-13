import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { workbookToBuffer } from "@/lib/xlsx-export";
import { MARKING_HEADERS, parseMarkingXlsx } from "@/modules/marking/parse-xlsx";
import {
  MARKING_COLUMN_HEADERS,
  MARKING_COLUMN_ORDER,
} from "@/modules/marking/query-filter";
import {
  buildMarkingExportWorkbook,
  markingExportCells,
  spoolMarkingWorkbook,
} from "@/modules/marking/xlsx-export";

const sample = {
  client: "Клиент А",
  phoneNumber: "070000000001",
  labelMts: "AO Client",
  labelMegafon: null,
  labelBeeline: null,
  labelT2: null,
  mavMts: null,
  mavMegafon: null,
  mavBeeline: null,
  mavT2: null,
};

describe("marking XLSX export", () => {
  it("round-trips a text phone and blank operator cells", async () => {
    const workbook = buildMarkingExportWorkbook([sample]);
    const sheet = workbook.getWorksheet("Маркировка и МАВ");
    expect(sheet?.getRow(2).getCell(2).numFmt).toBe("@");
    const parsed = await parseMarkingXlsx(await workbookToBuffer(workbook));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([{ sortIndex: 0, ...sample }]);
  });

  it("rejects a header-only workbook", async () => {
    const parsed = await parseMarkingXlsx(
      await workbookToBuffer(buildMarkingExportWorkbook([])),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.details).toEqual(["В файле нет строк с данными"]);
  });

  it("prefixes a formula-like label and keeps the phone digits", () => {
    expect(
      markingExportCells({
        ...sample,
        client: "=cmd",
        labelMts: "+name",
        phoneNumber: "70000000001",
      }),
    ).toEqual(["'=cmd", "70000000001", "'+name", "", "", "", "", "", "", ""]);
  });

  it("writes the screen columns in file order", () => {
    expect(MARKING_COLUMN_ORDER.map((id) => MARKING_COLUMN_HEADERS[id])).toEqual([
      ...MARKING_HEADERS,
    ]);
    const workbook = buildMarkingExportWorkbook([sample]);
    const sheet = workbook.getWorksheet("Маркировка и МАВ");
    const headers = MARKING_HEADERS.map(
      (_, index) => sheet?.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual([...MARKING_HEADERS]);
  });
});

describe("marking streamed export", () => {
  it("round-trips an empty client, a short phone, and a plain number", async () => {
    const buffer = await spoolMarkingWorkbook([
      {
        client: "",
        phoneNumber: "0123",
        labelMts: null,
        labelMegafon: "=name",
        labelBeeline: null,
        labelT2: null,
        mavMts: null,
        mavMegafon: null,
        mavBeeline: null,
        mavT2: null,
      },
    ]);
    const parsed = await parseMarkingXlsx(buffer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toMatchObject({
      client: "",
      phoneNumber: "0123",
      labelMegafon: "'=name",
    });
  });
});

describe("marking export cell types survive ExcelJS reload", () => {
  it("keeps a leading zero on the phone after a write", async () => {
    const workbook = buildMarkingExportWorkbook([sample]);
    const again = new ExcelJS.Workbook();
    await again.xlsx.load((await workbookToBuffer(workbook)) as never);
    const phone = again.getWorksheet("Маркировка и МАВ")?.getRow(2).getCell(2).value;
    expect(phone).toBe("070000000001");
  });
});
