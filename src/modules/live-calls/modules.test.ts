import { describe, expect, it } from "vitest";
import { selectCallModules, selectRegistrationModules } from "@/modules/live-calls/modules";

const LIVE = [
  "configurator-1",
  "management-1",
  "media-1",
  "media-2",
  "media-3",
  "scripting-1",
  "scripting-2",
  "signaling-1",
  "signaling-2",
  "sipproxy-1",
  "synchro-1",
];

describe("selectCallModules", () => {
  it("keeps the numbered signaling and scripting modules from the live list", () => {
    expect(selectCallModules(LIVE)).toEqual({
      ok: true,
      signaling: ["signaling-1", "signaling-2"],
      scripting: ["scripting-1", "scripting-2"],
    });
  });

  it("drops a repeated numbered name and a module outside the call family", () => {
    expect(
      selectCallModules([" signaling-1 ", "signaling-1", "media-1", "scripting-1"]),
    ).toEqual({
      ok: true,
      signaling: ["signaling-1"],
      scripting: ["scripting-1"],
    });
  });

  it("stops when a signaling or scripting name is not numbered", () => {
    expect(selectCallModules(["signaling-1", "signaling-west", "scripting-1"])).toEqual({
      ok: false,
      reason: "unexpected",
    });
    expect(selectCallModules(["Signaling-1", "scripting-1"])).toEqual({
      ok: false,
      reason: "unexpected",
    });
  });

  it("refuses a missing side and a fifth module", () => {
    expect(selectCallModules(["signaling-1", "media-1"])).toEqual({
      ok: false,
      reason: "none",
    });
    expect(
      selectCallModules([
        "signaling-1",
        "signaling-2",
        "signaling-3",
        "signaling-4",
        "signaling-5",
        "scripting-1",
      ]),
    ).toEqual({ ok: false, reason: "many" });
  });
});

describe("selectRegistrationModules", () => {
  it("reads only the side whose page is the shared template", () => {
    expect(
      selectRegistrationModules(LIVE, { signaling: true, scripting: false }),
    ).toEqual({
      ok: true,
      signaling: ["signaling-1", "signaling-2"],
      scripting: [],
    });
  });

  it("stops on an odd name or a fifth module of a side that is read", () => {
    expect(
      selectRegistrationModules(["signaling-west", "scripting-1"], {
        signaling: true,
        scripting: true,
      }),
    ).toEqual({
      ok: false,
      detail: "Модуль signaling или scripting назван не по шаблону.",
    });
    expect(
      selectRegistrationModules(
        ["signaling-1", "signaling-2", "signaling-3", "signaling-4", "signaling-5", "scripting-1"],
        { signaling: true, scripting: true },
      ).ok,
    ).toBe(false);
  });

  it("does not require the side that has a summary page", () => {
    expect(
      selectRegistrationModules(["signaling-west", "scripting-1", "media-1"], {
        signaling: false,
        scripting: true,
      }),
    ).toEqual({ ok: true, signaling: [], scripting: ["scripting-1"] });
  });
});
