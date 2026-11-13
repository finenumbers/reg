import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BDPN_BODY_CAP,
  BDPN_LOOKUP_URL,
  BDPN_TIMEOUT_MS,
  lookupBdpnNumber,
} from "@/modules/bdpn/client";

const HIT = `<input id="phoneInput" value="9994504444">
<div>Номер: <b>9994504444</b><br>Оператор: &quot;ВымпелКом&quot; ПАО<br>Территория: Новосибирская область<br>ИНН Оператора: 7713076301</div>`;

const MISS = `<input id="phoneInput" name="num" type="text" value="9000000000">
<div id="numResultsContainer"></div>
</html>`;

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lookupBdpnNumber", () => {
  it("posts one number to the pinned form and reads the card", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async () => htmlResponse(HIT));
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupBdpnNumber(" 9994504444 ")).resolves.toEqual({
      found: true,
      number: "9994504444",
      operator: '"ВымпелКом" ПАО',
      territory: "Новосибирская область",
      inn: "7713076301",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(BDPN_TIMEOUT_MS).toBe(15_000);
    expect(BDPN_BODY_CAP).toBe(1024 * 1024);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.nic-t.ru/bdpn/bdpn-proverka-nomera/");
    expect(url).toBe(BDPN_LOOKUP_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.cache).toBe("no-store");
    expect(init.body).toBe("num=9994504444");
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/html");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns a miss when the form echoes the number and the card is absent", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(MISS));
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupBdpnNumber("9000000000")).resolves.toEqual({
      found: false,
      number: "9000000000",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not follow a redirect or retry an HTTP error", async () => {
    const redirect = vi.fn(async () => htmlResponse(HIT, 302));
    vi.stubGlobal("fetch", redirect);
    await expect(lookupBdpnNumber("9994504444")).rejects.toMatchObject({
      name: "BdpnLookupError",
      code: "REDIRECT",
      httpStatus: 302,
    });
    expect(redirect).toHaveBeenCalledTimes(1);

    const failed = vi.fn(async () => htmlResponse("nope", 500));
    vi.stubGlobal("fetch", failed);
    await expect(lookupBdpnNumber("9994504444")).rejects.toMatchObject({
      code: "HTTP_ERROR",
      httpStatus: 500,
      message: "БДПН: HTTP 500",
    });
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("maps abort and a dropped connection without a second attempt", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const aborting = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal("fetch", aborting);
    await expect(lookupBdpnNumber("9994504444")).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "БДПН: сервис не ответил вовремя.",
    });
    expect(aborting).toHaveBeenCalledTimes(1);

    const dropped = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", dropped);
    await expect(lookupBdpnNumber("8123456789")).rejects.toEqual(
      expect.objectContaining({
        name: "BdpnLookupError",
        code: "NETWORK",
        message: "БДПН: нет соединения с сервисом.",
      }),
    );
    expect(dropped).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad number before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupBdpnNumber("79994504444")).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(lookupBdpnNumber("999450444")).rejects.toMatchObject({
      code: "INVALID",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body over the cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("x".repeat(BDPN_BODY_CAP + 1))),
    );

    await expect(lookupBdpnNumber("9994504444")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
      message: "БДПН: ответ больше допустимого размера.",
    });
  });

  it("does not read a card served from another host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = htmlResponse(HIT);
        return new Proxy(response, {
          get(target, prop) {
            if (prop === "url") return "https://evil.example/bdpn";
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }),
    );

    await expect(lookupBdpnNumber("9994504444")).rejects.toMatchObject({
      code: "REDIRECT",
    });
  });

  it("stops before the request when the caller already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const caller = new AbortController();
    caller.abort();

    await expect(lookupBdpnNumber("9994504444", caller.signal)).rejects.toMatchObject({
      code: "ABORTED",
      message: "БДПН: проверка прервана.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a 200 page that is not the form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("<html>login</html>")),
    );

    await expect(lookupBdpnNumber("9994504444")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});
