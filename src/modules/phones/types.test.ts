import { describe, expect, it } from "vitest";
import {
  isEndpointPhoneKind,
  parsePhoneKind,
} from "@/modules/phones/types";

describe("parsePhoneKind", () => {
  it("accepts the four current kinds", () => {
    expect(parsePhoneKind("gateways")).toBe("gateways");
    expect(parsePhoneKind("endpoints_registered")).toBe("endpoints_registered");
    expect(parsePhoneKind("endpoints_unregistered")).toBe(
      "endpoints_unregistered",
    );
    expect(parsePhoneKind("endpoints_error")).toBe("endpoints_error");
  });

  it("defaults unknown and null to endpoints_registered", () => {
    expect(parsePhoneKind("endpoints")).toBe("endpoints_registered");
    expect(parsePhoneKind(null)).toBe("endpoints_registered");
    expect(parsePhoneKind("nope")).toBe("endpoints_registered");
  });

  it("detects endpoint kinds", () => {
    expect(isEndpointPhoneKind("gateways")).toBe(false);
    expect(isEndpointPhoneKind("endpoints_registered")).toBe(true);
    expect(isEndpointPhoneKind("endpoints_error")).toBe(true);
  });
});
