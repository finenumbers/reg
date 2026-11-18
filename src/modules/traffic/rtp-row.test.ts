import { describe, expect, it } from "vitest";
import { RTP_ABSENT, RTP_PRESENT } from "@/modules/voipmonitor/legs";
import { paintsRtpRow } from "@/modules/traffic/rtp-row";

describe("paintsRtpRow", () => {
  it("paints a non-blocked row whose RTP is absent", () => {
    expect(paintsRtpRow("row", false, RTP_ABSENT)).toBe(true);
  });

  it("leaves a blocked row, a present RTP, and a blank RTP unpainted", () => {
    expect(paintsRtpRow("row", true, RTP_ABSENT)).toBe(false);
    expect(paintsRtpRow("row", false, RTP_PRESENT)).toBe(false);
    expect(paintsRtpRow("row", false, "")).toBe(false);
    expect(paintsRtpRow("row", false, undefined)).toBe(false);
  });

  it("does not paint the OPRS tail or a page with the paint off", () => {
    expect(paintsRtpRow("tail", false, RTP_ABSENT)).toBe(false);
    expect(paintsRtpRow("off", false, RTP_ABSENT)).toBe(false);
  });
});
