import { describe, expect, it } from "vitest";
import {
  duplicateFieldMessage,
  parseIdentifier,
  syslogNodeLabels,
} from "@/modules/smg-syslog/identifier";

describe("parseIdentifier", () => {
  it("stores a lowercase variable and rejects a hyphen or a digit first", () => {
    expect(parseIdentifier("  Fixer ", true)).toEqual({ ok: true, value: "fixer" });
    expect(parseIdentifier("a_b2", true)).toEqual({ ok: true, value: "a_b2" });
    expect(parseIdentifier("a-b", true)).toEqual({ ok: false });
    expect(parseIdentifier("1abc", true)).toEqual({ ok: false });
    expect(parseIdentifier("Казань", true)).toEqual({ ok: false });
    expect(parseIdentifier("a".repeat(32), true).ok).toBe(true);
    expect(parseIdentifier("a".repeat(33), true)).toEqual({ ok: false });
  });

  it("keeps an empty optional identifier as null and rejects an empty required one", () => {
    expect(parseIdentifier("   ", false)).toEqual({ ok: true, value: null });
    expect(parseIdentifier("", true)).toEqual({ ok: false });
  });
});

describe("duplicateFieldMessage", () => {
  it("names the colliding column", () => {
    expect(duplicateFieldMessage(["identifier"])).toBe("Такой идентификатор уже есть");
    expect(duplicateFieldMessage("smg_syslog_nodes_name_key")).toBe(
      "Такое название уже есть",
    );
    expect(duplicateFieldMessage(["smg_syslog_nodes_pkey"])).toBe("Такой IP уже есть");
    expect(duplicateFieldMessage(undefined)).toBe(
      "Такой IP, название или идентификатор уже есть",
    );
  });
});

describe("syslogNodeLabels", () => {
  it("drops the identifier so the journal stays keyed by address", () => {
    expect(
      syslogNodeLabels([{ ip: "10.1.2.3", name: "Казань", identifier: "kazan" }]),
    ).toEqual([{ ip: "10.1.2.3", name: "Казань" }]);
  });
});
