import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
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
    book.writeRow(["Москва, ул. Ленина", "7700000000", 4950000000]);
    book.writeRow(["=1+1", "+7700", null]);
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
