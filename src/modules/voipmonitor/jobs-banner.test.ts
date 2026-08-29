import { describe, expect, it } from "vitest";
import {
  composeVoipmonitorJobsBanner,
  composeVoipmonitorParkedHint,
} from "@/modules/voipmonitor/jobs-banner";

describe("composeVoipmonitorJobsBanner", () => {
  it("hides the banner when everything is enriched", () => {
    expect(
      composeVoipmonitorJobsBanner({
        voipmonitorUnenriched: 0,
        voipmonitorEnabled: true,
        cdrEnrichUnenriched: 0,
      }),
    ).toBeNull();
  });

  it("shows VoIPmonitor backlog and disabled hint", () => {
    expect(
      composeVoipmonitorJobsBanner({
        voipmonitorUnenriched: 1234,
        voipmonitorEnabled: true,
        voipmonitorHasWork: true,
        cdrEnrichUnenriched: 0,
      }),
    ).toContain("1");
    expect(
      composeVoipmonitorJobsBanner({
        voipmonitorUnenriched: 2,
        voipmonitorEnabled: false,
        cdrEnrichUnenriched: 0,
      }),
    ).toContain("выключено в Настройках");
  });

  it("shows PSTN and GeoIP from the same CDR enrich backlog", () => {
    const text = composeVoipmonitorJobsBanner({
      voipmonitorUnenriched: 0,
      voipmonitorEnabled: true,
      cdrEnrichUnenriched: 5,
    });
    expect(text).toMatch(/Без PSTN: 5 записей/);
    expect(text).toMatch(/Без GeoIP: 5 записей/);
    expect(text).not.toMatch(/VoIPmonitor/);
    expect(text).not.toMatch(/фоновое обогащение/);
  });

  it("keeps the banner when VoIPmonitor is clean but CDR enrich remains", () => {
    expect(
      composeVoipmonitorJobsBanner({
        voipmonitorUnenriched: 0,
        voipmonitorEnabled: false,
        cdrEnrichUnenriched: 1,
      }),
    ).toMatch(/Без PSTN/);
  });

  it("hides VoIPmonitor leftovers when the due queue is idle", () => {
    const text = composeVoipmonitorJobsBanner({
      voipmonitorUnenriched: 12,
      voipmonitorEnabled: true,
      voipmonitorHasWork: false,
      cdrEnrichUnenriched: 0,
    });
    expect(text).toBeNull();
  });

  it("joins VoIPmonitor and CDR enrich phrases", () => {
    const text = composeVoipmonitorJobsBanner({
      voipmonitorUnenriched: 2,
      voipmonitorEnabled: true,
      voipmonitorHasWork: true,
      cdrEnrichUnenriched: 5,
    });
    expect(text).toMatch(/VoIPmonitor: 2 записей/);
    expect(text).toMatch(/Без PSTN: 5 записей/);
    expect(text).toMatch(/Без GeoIP: 5 записей/);
    expect(text).toMatch(/фоновое обогащение/);
  });
});

describe("composeVoipmonitorParkedHint", () => {
  it("names parked leftovers without a banner tone", () => {
    expect(composeVoipmonitorParkedHint(0)).toBeNull();
    expect(composeVoipmonitorParkedHint(2)).toBe("Не найдены в VoIPmonitor: 2");
  });
});
