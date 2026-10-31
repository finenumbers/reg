import { describe, expect, it } from "vitest";
import { applyPhoneAnnotation } from "@/modules/phones/annotation";

const PASSWORD = "Регистрационный пароль";

describe("applyPhoneAnnotation", () => {
  it("changes only the category and keeps the supplier and the password", () => {
    const patch = applyPhoneAnnotation(
      { Поставщик: "Ростелеком", [PASSWORD]: "secret" },
      { supplier: "Ростелеком", category: "VIP" },
    );
    expect(patch.write).toBe(true);
    expect(patch.supplier).toBe("updated");
    expect(patch.category).toBe("updated");
    expect(patch.data).toEqual({
      Поставщик: "Ростелеком",
      Категория: "VIP",
      [PASSWORD]: "secret",
    });
  });

  it("changes only the supplier and keeps the category", () => {
    const patch = applyPhoneAnnotation(
      { Категория: "VIP", Описание: "Клиент" },
      { supplier: "МТС", category: "VIP" },
    );
    expect(patch.write).toBe(true);
    expect(patch.supplier).toBe("updated");
    expect(patch.category).toBe("updated");
    expect(patch.data).toEqual({
      Категория: "VIP",
      Поставщик: "МТС",
      Описание: "Клиент",
    });
  });

  it("deletes both keys when the file cells are empty and leaves the rest", () => {
    const patch = applyPhoneAnnotation(
      { Поставщик: "Ростелеком", Категория: "VIP", Описание: "Клиент" },
      { supplier: "", category: "  " },
    );
    expect(patch.write).toBe(true);
    expect(patch.supplier).toBe("cleared");
    expect(patch.category).toBe("cleared");
    expect(patch.data).toEqual({ Описание: "Клиент" });
  });

  it("does not write when both values are already the same", () => {
    const patch = applyPhoneAnnotation(
      { Поставщик: "Ростелеком", Категория: "VIP" },
      { supplier: "Ростелеком", category: "VIP" },
    );
    expect(patch.write).toBe(false);
    expect(patch.supplier).toBe("updated");
    expect(patch.category).toBe("updated");
  });
});
