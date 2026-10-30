import { describe, expect, it } from "vitest";
import { displayPhoneCellValue } from "@/modules/phones/ui/phones-table";

describe("displayPhoneCellValue", () => {
  it("shows registration password in plaintext", () => {
    expect(displayPhoneCellValue("Регистрационный пароль", "secret")).toBe(
      "secret",
    );
  });

  it("keeps empty password empty", () => {
    expect(displayPhoneCellValue("Регистрационный пароль", "")).toBe("");
    expect(displayPhoneCellValue("Регистрационный пароль", "  ")).toBe("  ");
  });

  it("passes through other columns unchanged", () => {
    expect(displayPhoneCellValue("Название", "gw1")).toBe("gw1");
  });

  it("shows Премиум for a blank terminating capacity", () => {
    expect(displayPhoneCellValue("ТЕРМ. емкость", "")).toBe("Премиум");
    expect(displayPhoneCellValue("ТЕРМ. емкость", "0")).toBe("0");
    expect(displayPhoneCellValue("ИНИЦ. емкость", "")).toBe("");
  });
});
