import { describe, expect, it } from "vitest";
import {
  xlsxCellXfs,
  xlsxFillRgbs,
  xlsxSheetStyleIds,
} from "@/modules/enrich/xlsx-ooxml";

describe("xlsx OOXML helpers", () => {
  it("reads solid fill rgbs and applyFill xfs", () => {
    const styles = `
      <styleSheet>
        <fills count="4">
          <fill><patternFill patternType="none"/></fill>
          <fill><patternFill patternType="gray125"/></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="FFBBF7D0"/></patternFill></fill>
          <fill><patternFill patternType="solid"><fgColor rgb="ffbfdbfe"/></patternFill></fill>
        </fills>
        <cellXfs count="3">
          <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
          <xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
          <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/>
        </cellXfs>
      </styleSheet>
    `;
    expect(xlsxFillRgbs(styles)).toEqual(["FFBBF7D0", "FFBFDBFE"]);
    expect(xlsxCellXfs(styles)).toEqual([
      { fillId: 0, applyFill: false },
      { fillId: 2, applyFill: true },
      { fillId: 3, applyFill: true },
    ]);
  });

  it("reads cell style indexes from a sheet", () => {
    const sheet = `<worksheet><sheetData><row r="2"><c r="A2" s="4"/><c r="B2" s="4"/></row></sheetData></worksheet>`;
    expect(xlsxSheetStyleIds(sheet)).toEqual([4, 4]);
  });
});
