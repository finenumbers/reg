import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerBlobDownload } from "@/lib/download-xlsx";

describe("triggerBlobDownload", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("leaves the blob address alive until the timer", () => {
    vi.useFakeTimers();
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:smg",
      revokeObjectURL: (value: string) => {
        revoked.push(value);
      },
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        href: "",
        download: "",
        rel: "",
        click: () => {},
        remove: () => {},
      }),
      body: { appendChild: () => {} },
    });
    triggerBlobDownload(new Blob(["x"]), "a.xlsx");
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(30_000);
    expect(revoked).toEqual(["blob:smg"]);
  });
});
