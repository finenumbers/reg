import { describe, expect, it } from "vitest";
import { dadataPartyUrl, yandexMapsUrl } from "@/modules/numbering-resource/links";

describe("yandexMapsUrl", () => {
  it("builds a Yandex search link from the address text", () => {
    expect(yandexMapsUrl("109316, г Москва, д 1")).toBe(
      "https://yandex.ru/maps/?text=109316%2C%20%D0%B3%20%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0%2C%20%D0%B4%201",
    );
  });

  it("returns null for an empty address", () => {
    expect(yandexMapsUrl("")).toBeNull();
    expect(yandexMapsUrl("   ")).toBeNull();
    expect(yandexMapsUrl(null)).toBeNull();
  });

  it("returns null when the encoded URL is longer than 2000 characters", () => {
    expect(yandexMapsUrl("а".repeat(1800))).toBeNull();
  });

  it("keeps the address inside the text query", () => {
    const url = yandexMapsUrl("https://evil.example");
    expect(url?.startsWith("https://yandex.ru/maps/?text=")).toBe(true);
    expect(url).not.toContain("https://evil");
  });
});

describe("dadataPartyUrl", () => {
  it("returns a URL for a 10-digit or 12-digit INN", () => {
    expect(dadataPartyUrl("7707083893")).toBe("https://dadata.ru/find/party/7707083893");
    expect(dadataPartyUrl(" 504719613900 ")).toBe(
      "https://dadata.ru/find/party/504719613900",
    );
  });

  it("returns null for an empty, short, or non-digit INN", () => {
    expect(dadataPartyUrl("")).toBeNull();
    expect(dadataPartyUrl("   ")).toBeNull();
    expect(dadataPartyUrl("12345678901")).toBeNull();
    expect(dadataPartyUrl("abc")).toBeNull();
    expect(dadataPartyUrl("77070493881")).toBeNull();
    expect(dadataPartyUrl(null)).toBeNull();
  });
});
