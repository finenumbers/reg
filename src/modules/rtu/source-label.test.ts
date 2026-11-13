import { describe, expect, it } from "vitest";
import {
  displayProviderCode,
  geographyProviderLabel,
} from "@/modules/rtu/source-label";

describe("geography provider label", () => {
  it("labels a stored DID provider code", () => {
    expect(displayProviderCode("aurora")).toBe("Aurora Telecom");
    expect(displayProviderCode("didww")).toBe("DIDWW");
    expect(displayProviderCode("other")).toBe("other");
  });

  it("shows Finenumbers as a manual source", () => {
    expect(geographyProviderLabel("finenumbers")).toBe("Вручную");
    expect(geographyProviderLabel("Finenumbers")).toBe("Вручную");
    expect(geographyProviderLabel("mcn")).toBe("MCN Telecom");
  });
});