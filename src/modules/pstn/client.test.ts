import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupPstnPhone, PstnLookupError } from "@/modules/pstn/client";
import { PSTN_UNREACHABLE_HINT } from "@/modules/pstn/types";

const creds = { baseUrl: "https://pstn.finenumbers.com", apiKey: "k" };

describe("pstn HTTP client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps AbortError to TIMEOUT with same-host hint", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(lookupPstnPhone("4996660000", creds)).rejects.toEqual(
      expect.objectContaining({
        name: "PstnLookupError",
        code: "TIMEOUT",
        message: PSTN_UNREACHABLE_HINT,
      }),
    );
    expect(PSTN_UNREACHABLE_HINT).toContain("http://pstn_app:5555");
  });

  it("maps fetch failed to NETWORK with same-host hint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    await expect(lookupPstnPhone("4996660000", creds)).rejects.toBeInstanceOf(
      PstnLookupError,
    );
    await expect(lookupPstnPhone("4996660000", creds)).rejects.toMatchObject({
      code: "NETWORK",
      message: PSTN_UNREACHABLE_HINT,
    });
  });
});
