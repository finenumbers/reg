import { describe, expect, it } from "vitest";
import { displayPhoneCellValue } from "@/modules/phones/ui/phones-table";

describe("displayPhoneCellValue", () => {
  it("masks non-empty registration password", () => {
    expect(displayPhoneCellValue("Регистрационный пароль", "secret")).toBe(
      "••••••",
    );
  });

  it("keeps empty password empty", () => {
    expect(displayPhoneCellValue("Регистрационный пароль", "")).toBe("");
    expect(displayPhoneCellValue("Регистрационный пароль", "  ")).toBe("  ");
  });

  it("does not mask other columns", () => {
    expect(displayPhoneCellValue("Название", "gw1")).toBe("gw1");
  });
});
