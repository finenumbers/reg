import { describe, expect, it } from "vitest";
import { selectCallModules } from "@/modules/live-calls/modules";

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

  it("drops a repeated name and a name that is not a numbered call module", () => {
    expect(
      selectCallModules([
        " signaling-1 ",
        "signaling-1",
        "signaling-west",
        "Signaling-1",
        "media-1",
        "scripting-1",
      ]),
    ).toEqual({
      ok: true,
      signaling: ["signaling-1"],
      scripting: ["scripting-1"],
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
