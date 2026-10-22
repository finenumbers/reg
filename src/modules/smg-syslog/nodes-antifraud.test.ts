import { describe, expect, it } from "vitest";
import { assertAntifraudIdentifier, SyslogNodeError } from "@/modules/smg-syslog/nodes";

describe("assertAntifraudIdentifier", () => {
  it("allows an enabled node and a disabled node that keeps its identifier", () => {
    expect(() =>
      assertAntifraudIdentifier({
        enabled: true,
        identifier: null,
        identifierCleared: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertAntifraudIdentifier({
        enabled: false,
        identifier: "kazan",
        identifierCleared: false,
      }),
    ).not.toThrow();
  });

  it("refuses to turn antifraud off without an identifier", () => {
    expect(() =>
      assertAntifraudIdentifier({
        enabled: false,
        identifier: null,
        identifierCleared: false,
      }),
    ).toThrow(SyslogNodeError);
    try {
      assertAntifraudIdentifier({
        enabled: false,
        identifier: null,
        identifierCleared: false,
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "ANTIFRAUD_IDENTIFIER",
        message: "Чтобы выключить АнтиФрод, укажите идентификатор",
      });
    }
  });

  it("refuses to clear the identifier while antifraud is off", () => {
    expect(() =>
      assertAntifraudIdentifier({
        enabled: false,
        identifier: null,
        identifierCleared: true,
      }),
    ).toThrow("Нельзя очистить идентификатор, пока АнтиФрод выключен");
  });
});
