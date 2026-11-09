import { describe, expect, it } from "vitest";
import { bossRequestTarget, domainPath, domainStatPath } from "@/modules/vats/allowlist";
import { domainCardView } from "@/modules/vats/card";
import { domainPutBody } from "@/modules/vats/client";
import {
  nameListHref,
  parseClientValue,
  parseDomainName,
  parseTelnum,
  passwordWrite,
} from "@/modules/vats/names";
import { parseVatsOrigin } from "@/modules/vats/origin";
import { readbackAccepts } from "@/modules/vats/readback";
import { keptPreviousList, nextNameList } from "@/modules/vats/snapshot";

describe("VATS origin", () => {
  it("accepts an https origin and rejects a path, userinfo, or http", () => {
    expect(parseVatsOrigin("https://pbx.example")).toBe("https://pbx.example");
    expect(parseVatsOrigin("https://pbx.example/")).toBe("https://pbx.example");
    expect(parseVatsOrigin("https://pbx.example:8443")).toBe("https://pbx.example:8443");
    expect(parseVatsOrigin("http://pbx.example")).toBeNull();
    expect(parseVatsOrigin("https://user:pw@pbx.example")).toBeNull();
    expect(parseVatsOrigin("https://pbx.example/sys")).toBeNull();
    expect(parseVatsOrigin("https://pbx.example?x=1")).toBeNull();
  });
});

describe("VATS names", () => {
  it("rejects traversal and keeps a dotted domain", () => {
    expect(parseDomainName("domain.pbx.com")).toBe("domain.pbx.com");
    expect(parseDomainName("../etc")).toBeNull();
    expect(parseDomainName("a/b")).toBeNull();
    expect(parseDomainName("a b")).toBeNull();
    expect(parseTelnum("79000000000")).toBe("79000000000");
    expect(parseTelnum("+79000000000")).toBeNull();
    expect(parseClientValue("  Acme  ")).toBe("Acme");
    expect(parseClientValue("")).toBe("");
  });

  it("keeps a list link inside one path segment", () => {
    expect(nameListHref("/vats/domains", "example.com")).toBe(
      "/vats/domains/example.com",
    );
    expect(nameListHref("/vats/telnums", "79000000000")).toBe(
      "/vats/telnums/79000000000",
    );
    expect(nameListHref("/vats/domains", "a/b")).toBe("/vats/domains/a%2Fb");
  });

  it("does not clear a stored password when the field is blank", () => {
    expect(passwordWrite(undefined, true)).toBe("keep");
    expect(passwordWrite("", true)).toBe("keep");
    expect(passwordWrite(undefined, false)).toBe("missing");
    expect(passwordWrite("next", true)).toBe("replace");
  });
});

describe("VATS allowlist", () => {
  it("allows the named reads and one domain put", () => {
    expect(bossRequestTarget("GET", "/sys/boss/v1/domains")).toBe("/sys/boss/v1/domains");
    expect(bossRequestTarget("GET", "/sys/boss/v1/telnums")).toBe("/sys/boss/v1/telnums");
    expect(bossRequestTarget("GET", "/sys/boss/v1/gateways")).toBe(
      "/sys/boss/v1/gateways",
    );
    expect(bossRequestTarget("GET", "/sys/boss/v1/routes")).toBe("/sys/boss/v1/routes");
    expect(bossRequestTarget("GET", "/sys/boss/v1/dialplans")).toBe(
      "/sys/boss/v1/dialplans",
    );
    expect(bossRequestTarget("PUT", "/sys/boss/v1/domains/domain.pbx.com")).toBe(
      "/sys/boss/v1/domains/domain.pbx.com",
    );
    expect(bossRequestTarget("GET", "/sys/boss/v1/telnums/79000000000")).toBe(
      "/sys/boss/v1/telnums/79000000000",
    );
    expect(bossRequestTarget("GET", "/sys/boss/v1/domains/domain.pbx.com/stat")).toBe(
      "/sys/boss/v1/domains/domain.pbx.com/stat",
    );
    expect(domainStatPath("domain.pbx.com")).toBe(
      "/sys/boss/v1/domains/domain.pbx.com/stat",
    );
  });

  it("refuses sessions, deletes, and nested writes", () => {
    expect(bossRequestTarget("DELETE", "/sys/boss/v1/domains/domain.pbx.com")).toBeNull();
    expect(bossRequestTarget("POST", "/sys/boss/v1/domains/domain.pbx.com")).toBeNull();
    expect(
      bossRequestTarget("GET", "/sys/boss/v1/domains/domain.pbx.com/session"),
    ).toBeNull();
    expect(
      bossRequestTarget("GET", "/sys/boss/v1/domains/domain.pbx.com/services"),
    ).toBeNull();
    expect(
      bossRequestTarget("GET", "/sys/boss/v1/domains/domain.pbx.com/stat/extra"),
    ).toBeNull();
    expect(
      bossRequestTarget("PUT", "/sys/boss/v1/domains/domain.pbx.com/stat"),
    ).toBeNull();
    expect(domainStatPath("a/b")).toBeNull();
    expect(domainStatPath("../etc")).toBeNull();
    expect(bossRequestTarget("GET", "/sys/boss/v1/users/a/auth")).toBeNull();
    expect(bossRequestTarget("PUT", "/sys/boss/v1/telnums/79000000000")).toBeNull();
    expect(
      bossRequestTarget("PUT", "/sys/boss/v1/domains/domain.pbx.com/isfrozen"),
    ).toBeNull();
    expect(domainPath("../etc")).toBeNull();
    expect(domainPath("a/b")).toBeNull();
  });
});

describe("VATS put body", () => {
  it("sends exactly one field", () => {
    expect(domainPutBody("client", "Acme")).toBe('{"client":"Acme"}');
    expect(Object.keys(JSON.parse(domainPutBody("language", "en-US")))).toEqual([
      "language",
    ]);
    expect(Object.keys(JSON.parse(domainPutBody("client", 'a"b')))).toEqual(["client"]);
    expect(() => domainPutBody("language", "de-DE")).toThrow();
  });
});

describe("VATS snapshot", () => {
  const stored = { origin: "https://old.example", names: ["domain.pbx.com"] };

  it("keeps a non-empty list when the next read is empty or unreadable", () => {
    expect(nextNameList(stored, "https://old.example", [])).toEqual(stored);
    expect(nextNameList(stored, "https://new.example", [])).toEqual(stored);
    expect(nextNameList(stored, "https://new.example", null)).toEqual(stored);
    expect(keptPreviousList(stored, [])).toBe(true);
  });

  it("replaces a list only with names", () => {
    expect(nextNameList(stored, "https://new.example", ["other.pbx.com"])).toEqual({
      origin: "https://new.example",
      names: ["other.pbx.com"],
    });
    expect(nextNameList(null, "https://new.example", [])).toEqual({
      origin: "https://new.example",
      names: [],
    });
  });
});

describe("VATS readback", () => {
  const before = {
    name: "domain.pbx.com",
    client: "Old",
    language: "ru-RU",
    dialplan: "dp",
  };

  it("accepts the one changed field", () => {
    expect(readbackAccepts(before, { ...before, client: "New" }, "client", "New")).toBe(
      true,
    );
  });

  it("rejects a second field change", () => {
    expect(
      readbackAccepts(
        before,
        { ...before, client: "New", dialplan: "other" },
        "client",
        "New",
      ),
    ).toBe(false);
    expect(readbackAccepts(before, { ...before }, "client", "New")).toBe(false);
  });
});

describe("VATS domain card", () => {
  it("does not expose the access URL or routing fields", () => {
    const view = domainCardView("domain.pbx.com", {
      name: "domain.pbx.com",
      client: "Acme",
      language: "ru-RU",
      accessURL: "https://domain.pbx.com/login",
      dialplan: "dp",
      route: "rt",
      services: ["autocaller"],
      billingType: "billable",
      frozen: false,
    });
    expect(view.client).toBe("Acme");
    expect(Object.keys(view)).not.toContain("accessURL");
    expect(Object.keys(view)).not.toContain("dialplan");
    expect(JSON.stringify(view)).not.toContain("login");
  });
});
