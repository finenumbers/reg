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

  it("asks to retry when the RTU screen lock times out", () => {
    expect(
      markingApplyHttpError(
        Object.assign(new Error("canceling statement due to lock timeout"), {
          code: "55P03",
        }),
      ),
    ).toEqual({
      status: 409,
      error: "Снимок «Управление РТУ» обновляется. Повторите.",
      details: ["Снимок «Управление РТУ» обновляется. Повторите."],
    });
  });

  it("asks to retry when the read exceeds the statement timeout", () => {
    expect(
      markingApplyHttpError(new Error("canceling statement due to statement timeout")),
    ).toEqual({
      status: 503,
      error: "Не удалось прочитать набор. Повторите.",
      details: ["Не удалось прочитать набор. Повторите."],
    });
  });
});
