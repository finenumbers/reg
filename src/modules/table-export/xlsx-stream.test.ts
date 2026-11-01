import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { excelColumnWidth, cappedCodePointLength } from "@/lib/xlsx-export";
import { openStreamingWorkbook } from "@/modules/table-export/xlsx-stream";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writtenFile(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "reg-xlsx-test-"));
  dirs.push(dir);
  return { dir, file: path.join(dir, "out.xlsx") };
}

describe("streaming catalog workbook", () => {
  it("borders the filled table and sets a filter on that rectangle", async () => {
    const { file } = await writtenFile();
    const book = openStreamingWorkbook({
      filePath: file,
      sheetName: "Ресурс нумерации",
      columns: [
        { header: "Юридический адрес", text: true },
        { header: "ИНН", text: true, align: "right" },
        { header: "Начало", bold: true },
      ],
    });
    await book.writeRow(["Москва, ул. Ленина", "7700000000", 4950000000]);
    await book.writeRow(["=1+1", "+7700", null]);
    await book.finish();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet("Ресурс нумерации");
    expect(sheet).toBeTruthy();
    expect(sheet!.autoFilter).toBe("A1:C3");
    expect(sheet!.getRow(1).getCell(1).border?.top?.style).toBe("thin");
    expect(sheet!.getRow(1).getCell(2).border?.bottom?.style).toBe("thin");

    const address = sheet!.getRow(2).getCell(1);
    const inn = sheet!.getRow(2).getCell(2);
    expect(address.value).toBe("Москва, ул. Ленина");
    expect(address.hyperlink).toBeUndefined();
    expect(inn.value).toBe("7700000000");
    expect(inn.numFmt).toBe("@");
    expect(inn.hyperlink).toBeUndefined();
    expect(inn.alignment?.horizontal).toBe("right");
    expect(inn.border?.left?.style).toBe("thin");
    expect(sheet!.getRow(2).getCell(3).font?.bold).toBe(true);
    expect(sheet!.getRow(2).getCell(3).value).toBe(4950000000);
    expect(sheet!.getRow(3).getCell(1).value).toBe("'=1+1");
    expect(sheet!.getRow(3).getCell(2).value).toBe("'+7700");
    expect(sheet!.getRow(3).getCell(3).value).toBeNull();
    expect(sheet!.getColumn(1).width).toBe(
      excelColumnWidth(cappedCodePointLength("Москва, ул. Ленина")),
    );
    expect(sheet!.getColumn(2).width).toBe(excelColumnWidth("7700000000".length));
    expect(sheet!.getColumn(3).width).toBe(excelColumnWidth(String(4950000000).length));
    await expect(access(`${file}.rows`)).rejects.toThrow();
  });

  it("stores a width from the longest cell and caps it at 255", async () => {
    const { file } = await writtenFile();
    const book = openStreamingWorkbook({
      filePath: file,
      sheetName: "Свободные номера",
      columns: [{ header: "Номер", text: true }],
    });
    await book.writeRow(["я".repeat(100)]);
    await book.finish();

    const fitted = new ExcelJS.Workbook();
    await fitted.xlsx.readFile(file);
    expect(fitted.getWorksheet("Свободные номера")!.getColumn(1).width).toBe(102);

    const cappedFile = path.join(path.dirname(file), "capped.xlsx");
    const capped = openStreamingWorkbook({
      filePath: cappedFile,
      sheetName: "Свободные номера",
      columns: [{ header: "Номер", text: true }],
    });
    await capped.writeRow(["я".repeat(300)]);
    await capped.finish();
    const wide = new ExcelJS.Workbook();
    await wide.xlsx.readFile(cappedFile);
    expect(wide.getWorksheet("Свободные номера")!.getColumn(1).width).toBe(255);
  });

  it("drops the spool and does not write a workbook after abort", async () => {
    const { file } = await writtenFile();
    const book = openStreamingWorkbook({
      filePath: file,
      sheetName: "Свободные номера",
      columns: [{ header: "Номер", text: true }],
    });
    await book.writeRow(["100"]);
    book.abort();
    await expect(book.finish()).resolves.toBe(1);
    await expect(access(file)).rejects.toThrow();
    await expect(access(`${file}.rows`)).rejects.toThrow();
  });

  it("keeps a filter on the header when nothing matched", async () => {
    const { file } = await writtenFile();
    const book = openStreamingWorkbook({
      filePath: file,
      sheetName: "Свободные номера",
      columns: [{ header: "Номер", text: true }],
    });
    await book.finish();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    const sheet = workbook.getWorksheet("Свободные номера");
    expect(sheet!.autoFilter).toBe("A1:A1");
    expect(sheet!.getRow(1).getCell(1).border?.right?.style).toBe("thin");
    expect(sheet!.getRow(2).getCell(1).value).toBeNull();
  });
});
