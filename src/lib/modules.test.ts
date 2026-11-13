import { describe, expect, it } from "vitest";
import { FEATURE_MODULES } from "@/lib/modules";

const KNOWN_NAV_GROUPS = new Set([
  "primary",
  "cdr",
  "smg",
  "analytics",
  "links",
  "catalog",
  "admin",
  "vats",
]);

function idsInGroup(group: "cdr" | "smg" | "analytics" | "catalog" | "admin"): string[] {
  return FEATURE_MODULES.filter((m) => m.navGroup === group).map((m) => m.id);
}

describe("FEATURE_MODULES nav groups", () => {
  it("puts Управление РТУ first in the primary nav", () => {
    expect(FEATURE_MODULES[0]).toMatchObject({
      id: "rtu",
      title: "Управление РТУ",
      href: "/rtu",
      navPermission: "phones:read",
    });
    expect(FEATURE_MODULES[1]).toMatchObject({
      id: "marking",
      title: "Маркировка и МАВ",
      href: "/marking",
      navPermission: "phones:read",
    });
    expect(FEATURE_MODULES[1]?.navGroup).toBeUndefined();
    expect(FEATURE_MODULES[2]?.id).toBe("registrations");
    expect(FEATURE_MODULES.map((module) => module.id)).not.toContain("number-geography");
  });

  it("keeps Детализация and Статистика as analytics, in that order", () => {
    expect(idsInGroup("analytics")).toEqual(["detail", "stats"]);
  });

  it("keeps CDR without Детализация", () => {
    expect(idsInGroup("cdr")).toEqual([
      "live-calls",
      "oprs",
      "traffic",
      "operators",
      "geography",
      "raw",
    ]);
  });

  it("keeps SMG traffic before the full dump and syslog", () => {
    expect(idsInGroup("smg")).toEqual(["smg-traffic", "smg", "antifraud", "smg-syslog"]);
    const hrefs = FEATURE_MODULES.map((module) => module.href);
    expect(hrefs.indexOf("/raw")).toBeLessThan(hrefs.indexOf("/smg/traffic"));
    expect(hrefs.indexOf("/smg/traffic")).toBeLessThan(hrefs.indexOf("/smg"));
    expect(hrefs.indexOf("/smg")).toBeLessThan(hrefs.indexOf("/antifraud"));
    expect(hrefs.indexOf("/antifraud")).toBeLessThan(hrefs.indexOf("/smg/syslog"));
    expect(hrefs.indexOf("/smg/syslog")).toBeLessThan(hrefs.indexOf("/vats"));
    expect(hrefs.indexOf("/vats")).toBeLessThan(hrefs.indexOf("/vats/telnums"));
    expect(hrefs.indexOf("/vats/telnums")).toBeLessThan(hrefs.indexOf("/vats/settings"));
    expect(hrefs.indexOf("/vats/settings")).toBeLessThan(hrefs.indexOf("/detail"));
    expect(FEATURE_MODULES.map((module) => module.id)).not.toContain("vats-users");
    const titles = Object.fromEntries(
      FEATURE_MODULES.map((module) => [module.id, module.title]),
    );
    expect(titles.smg).toBe("Данные SMG");
    expect(titles.antifraud).toBe("Ошибки АнтиФрод");
    expect(titles["smg-syslog"]).toBe("Архивы Syslog");
  });

  it("keeps masks and tariffs together above settings", () => {
    expect(idsInGroup("catalog")).toEqual(["masks", "tariffs"]);
    const masks = FEATURE_MODULES.find((module) => module.id === "masks");
    expect(masks).toMatchObject({
      title: "Маски и типы",
      href: "/masks",
      navPermission: "phones:read",
      navGroup: "catalog",
    });
  });

  it("keeps admin without Статистика and without Тарификация", () => {
    expect(idsInGroup("admin")).toEqual(["settings", "exceptions", "jobs", "audit"]);
  });

  it("uses only known nav groups", () => {
    for (const feature of FEATURE_MODULES) {
      expect(KNOWN_NAV_GROUPS.has(feature.navGroup ?? "primary")).toBe(true);
    }
  });

  it("keeps catalog links internal, in screen order", () => {
    const featureIds = FEATURE_MODULES.map((module) => module.id as string);
    expect(featureIds).toContain("free-numbers");
    expect(featureIds).toContain("purchased-numbers");
    expect(featureIds).toContain("numbering-resource");
    expect(featureIds).toContain("numbering-sync");
    expect(featureIds).toContain("numbering-load");
    expect(featureIds).not.toContain("did-free-numbers");
    expect(featureIds).not.toContain("pstn-numbering");
  });

  it("keeps the numbering links in catalog order", () => {
    const free = FEATURE_MODULES.find((module) => module.id === "free-numbers");
    expect(free).toMatchObject({
      title: "Свободные номера",
      href: "/free-numbers",
      navPermission: "phones:read",
      navGroup: "links",
    });
    const purchased = FEATURE_MODULES.find((module) => module.id === "purchased-numbers");
    expect(purchased).toMatchObject({
      title: "Купленные номера",
      href: "/purchased-numbers",
      navPermission: "phones:read",
      navGroup: "links",
    });
    const numbering = FEATURE_MODULES.find(
      (module) => module.id === "numbering-resource",
    );
    expect(numbering).toMatchObject({
      title: "Ресурс нумерации",
      href: "/numbering-resource",
      navPermission: "phones:read",
      navGroup: "links",
    });
    const sync = FEATURE_MODULES.find((module) => module.id === "numbering-sync");
    expect(sync).toMatchObject({
      title: "Синхронизация",
      href: "/numbering-sync",
      navPermission: "settings:write",
      navGroup: "links",
    });
    const load = FEATURE_MODULES.find((module) => module.id === "numbering-load");
    expect(load).toMatchObject({
      title: "Загрузка нумерации",
      href: "/numbering-load",
      navPermission: "settings:write",
      navGroup: "links",
    });
    const freeIndex = FEATURE_MODULES.findIndex((module) => module.id === "free-numbers");
    const purchasedIndex = FEATURE_MODULES.findIndex(
      (module) => module.id === "purchased-numbers",
    );
    const numberingIndex = FEATURE_MODULES.findIndex(
      (module) => module.id === "numbering-resource",
    );
    const syncIndex = FEATURE_MODULES.findIndex((module) => module.id === "numbering-sync");
    const loadIndex = FEATURE_MODULES.findIndex((module) => module.id === "numbering-load");
    expect(purchasedIndex).toBe(freeIndex + 1);
    expect(numberingIndex).toBe(purchasedIndex + 1);
    expect(syncIndex).toBe(numberingIndex + 1);
    expect(loadIndex).toBe(syncIndex + 1);
  });
});
