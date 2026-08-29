import { describe, expect, it } from "vitest";
import { composeVoipmonitorJobsBanner } from "@/modules/voipmonitor/jobs-banner";

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

  it("joins VoIPmonitor and CDR enrich phrases", () => {
    const text = composeVoipmonitorJobsBanner({
      voipmonitorUnenriched: 2,
      voipmonitorEnabled: true,
      cdrEnrichUnenriched: 5,
    });
    expect(text).toMatch(/VoIPmonitor: 2 записей/);
    expect(text).toMatch(/Без PSTN: 5 записей/);
    expect(text).toMatch(/Без GeoIP: 5 записей/);
    expect(text).toMatch(/фоновое обогащение/);
  });
});
