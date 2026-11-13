import { describe, expect, it } from "vitest";
import { markingApplyHttpError } from "@/modules/marking/apply";

describe("markingApplyHttpError", () => {
  it("keeps the previous snapshot when the phone is already unique", () => {
    expect(markingApplyHttpError({ code: "P2002" })).toEqual({
      status: 400,
      error: "Файл не подходит для маркировки и МАВ",
      details: ["Повтор номера. Снимок не изменён."],
    });
  });

  it("asks the operator to retry when the catalog lock is busy", () => {
    expect(
      markingApplyHttpError({
        code: "P2028",
        message: "Unable to start a transaction in the given time.",
      }),
    ).toEqual({
      status: 409,
      error: "Идёт загрузка маркировки. Повторите, когда она закончится.",
      details: ["Идёт загрузка маркировки. Повторите, когда она закончится."],
    });
  });

  it("leaves an unexpected error unmapped", () => {
    expect(markingApplyHttpError(new Error("disk"))).toBeNull();
  });
});
