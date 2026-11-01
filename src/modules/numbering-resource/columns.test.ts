import { describe, expect, it } from "vitest";
import {
  isRightAlignedNumberingColumn,
  NUMBERING_COLUMNS,
} from "@/modules/numbering-resource/columns";

describe("isRightAlignedNumberingColumn", () => {
  it("keeps capacity, INN, and UVR on the right", () => {
    const right = NUMBERING_COLUMNS.filter(isRightAlignedNumberingColumn);
    expect(right).toEqual(["capacity", "inn", "uvrAntifraud"]);
  });
});