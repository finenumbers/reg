import { describe, expect, it } from "vitest";
import { composeVoipmonitorJobsBanner } from "@/modules/voipmonitor/jobs-banner";

describe("composeVoipmonitorJobsBanner", () => {
  it("hides the banner when everything is enriched", () => {
    expect(composeVoipmonitorJobsBanner(0, true)).toBeNull();
  });

  it("shows backlog and disabled hint", () => {
    expect(composeVoipmonitorJobsBanner(1234, true)).toContain("1");
    expect(composeVoipmonitorJobsBanner(2, false)).toContain(
      "выключено в Настройках",
    );
  });
});
