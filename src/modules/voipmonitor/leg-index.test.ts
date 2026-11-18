import { describe, expect, it } from "vitest";
import { oprsGuiHost } from "@/modules/oprs/calltrace";
import { calltraceCells, RTP_ABSENT, RTP_PRESENT } from "@/modules/voipmonitor/legs";
import {
  indexVoipmonitorLegs,
  screenLegHost,
  type StoredLegIndex,
} from "@/modules/voipmonitor/leg-index";
import { isSafeVoipmonitorHref } from "@/modules/voipmonitor/url";
import * as script from "../../../scripts/rtp-leg-index.mjs";

const GUI = "https://gui.example";

function absentOn(host: string, indexed: StoredLegIndex): boolean {
  if (!host) return false;
  if (indexed.outAudio === false && indexed.outHost === host) return true;
  if (indexed.inAudio === false && indexed.inHost === host && indexed.outHost !== host) {
    return true;
  }
  return false;
}

describe("screen leg index", () => {
  it("uses the same host the screen compares", () => {
    const samples = [
      "https://User:pass@Example.COM:443/path?q=1#x",
      "http://Example.COM:80/a",
      "https://example.com:8443/a",
      "https://user@host.example/cdr",
      "https://[2001:DB8::1]:443/a",
      " https://gui.example/a ",
      "javascript:alert(1)",
      "ftp://example.com/file",
      "",
      "https://пример.рф/a",
    ];
    for (const url of samples) {
      expect(screenLegHost(url)).toBe(script.screenLegHost(url));
      expect(screenLegHost(url)).toBe(hostOf(url));
    }
    expect(oprsGuiHost(` ${GUI}/app `)).toBe(new URL(GUI).host);
    expect(oprsGuiHost("https://пример.рф")).toBe(new URL("https://пример.рф").host);
    expect(screenLegHost("https://пример.рф/a")).toBe("xn--e1afmkfd.xn--p1ai");
  });

  it("keeps the checkbox on the same RTP word the row paints", () => {
    const cases: Array<{
      legs: unknown;
      gui: string;
      word: string;
    }> = [
      {
        gui: GUI,
        word: RTP_ABSENT,
        legs: {
          out: { url: "https://gui.example/out", audio: false },
          in: { url: "https://gui.example/in", audio: true },
        },
      },
      {
        gui: GUI,
        word: RTP_PRESENT,
        legs: {
          out: { url: "https://GUI.example:443/out", audio: true },
          in: { url: "https://gui.example/in", audio: false },
        },
      },
      {
        gui: GUI,
        word: "",
        legs: {
          out: { url: "https://gui.example/out" },
          in: { url: "https://gui.example/in", audio: false },
        },
      },
      {
        gui: GUI,
        word: "",
        legs: {
          out: { url: "https://gui.example/out", audio: "false" },
          in: { url: "https://gui.example/in", audio: false },
        },
      },
      {
        gui: GUI,
        word: RTP_ABSENT,
        legs: {
          out: { url: "https://other.example/out", audio: true },
          in: { url: " https://gui.example:443/in ", audio: false },
        },
      },
      {
        gui: GUI,
        word: RTP_PRESENT,
        legs: {
          out: { url: "https://other.example/out", audio: false },
          in: { url: "https://gui.example/in", audio: true },
        },
      },
      {
        gui: GUI,
        word: RTP_ABSENT,
        legs: {
          out: { url: "javascript:alert(1)", audio: false },
          in: { url: "https://gui.example/in", audio: false },
        },
      },
      {
        gui: "",
        word: "",
        legs: {
          out: { url: "https://gui.example/out", audio: false },
        },
      },
      {
        gui: "https://пример.рф",
        word: RTP_ABSENT,
        legs: {
          out: { url: "https://пример.рф/out", audio: false },
        },
      },
    ];
    for (const item of cases) {
      const indexed = indexVoipmonitorLegs(item.legs);
      expect(indexed).toEqual(script.indexVoipmonitorLegs(item.legs));
      const parsed = calltraceCells(indexedAsLegs(item.legs), item.gui);
      expect(parsed.rtp).toBe(item.word);
      expect(absentOn(oprsGuiHost(item.gui), indexed)).toBe(item.word === RTP_ABSENT);
      if (item.word === RTP_ABSENT) {
        const leg = visibleUrl(item.legs, item.gui);
        expect(isSafeVoipmonitorHref(leg, item.gui)).toBe(true);
        expect(screenLegHost(leg)).toBe(oprsGuiHost(item.gui));
      }
    }
  });
});

function hostOf(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.host;
  } catch {
    return "";
  }
}

function indexedAsLegs(legs: unknown) {
  const raw =
    legs && typeof legs === "object" && !Array.isArray(legs)
      ? (legs as {
          in?: { url?: unknown; audio?: unknown; cdrId?: unknown; callId?: unknown };
          out?: { url?: unknown; audio?: unknown; cdrId?: unknown; callId?: unknown };
        })
      : {};
  return {
    in: raw.in ? leg(raw.in) : undefined,
    out: raw.out ? leg(raw.out) : undefined,
  };
}

function leg(value: {
  url?: unknown;
  audio?: unknown;
  cdrId?: unknown;
  callId?: unknown;
}) {
  const ref: { url: string; cdrId: string; callId: string; audio?: boolean } = {
    url: typeof value.url === "string" ? value.url : "",
    cdrId: typeof value.cdrId === "string" ? value.cdrId : "",
    callId: typeof value.callId === "string" ? value.callId : "",
  };
  if (value.audio === true || value.audio === false) ref.audio = value.audio;
  return ref;
}

function visibleUrl(legs: unknown, gui: string): string {
  const cells = calltraceCells(indexedAsLegs(legs), gui);
  return cells.outUrl || cells.inUrl;
}
