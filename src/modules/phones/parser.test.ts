import { describe, expect, it } from "vitest";
import { parsePhonesStdout } from "@/modules/phones/parser";
import { ENDPOINT_HEADERS, GATEWAY_HEADERS } from "@/modules/phones/types";

const sampleEndpoint = {
  Название: "ep1",
  Описание: "desc",
  "Номер оконечного оборудования": "79001112233",
  "Инициирующее устройство": "Да",
  "Терминирующее устройство": "Нет",
  Регистрация: "Да",
  Зона: "z1",
  "ИНИЦ. список адресов": "",
  "ИНИЦ. порт": "",
  "ИНИЦ. зона": "",
  "ИНИЦ. емкость": "10",
  "Входящие группы": "g1",
  "ТЕРМ. список адресов": "",
  "ТЕРМ. порт": "",
  "ТЕРМ. зона": "",
  "ТЕРМ. емкость": "",
  "Регистрационное имя": "user1",
  "Регистрационный пароль": "secret-pass",
  "Список разрешенных адресов для регистрации": "",
};

describe("parsePhonesStdout", () => {
  it("parses endpoints and gateways with plaintext password", () => {
    const payload = {
      version: 1,
      endpointHeaders: [...ENDPOINT_HEADERS],
      gatewayHeaders: [...GATEWAY_HEADERS],
      endpointCount: 1,
      gatewayCount: 1,
      endpoints: [sampleEndpoint],
      gateways: [
        {
          Название: "gw1",
          Описание: "gateway",
          "Инициирующее устройство": "Да",
          "Терминирующее устройство": "Да",
          "Протокол сигнализации": "SIP",
          "ИНИЦ. список адресов": "1.2.3.4",
          "ИНИЦ. порт": "5060",
          "ИНИЦ. зона": "z",
          "ИНИЦ. емкость": "100",
          "Входящие группы": "A;B",
          "ТЕРМ. список адресов": "",
          "ТЕРМ. порт": "",
          "ТЕРМ. зона": "",
          "ТЕРМ. емкость": "",
        },
      ],
    };

    const parsed = parsePhonesStdout(JSON.stringify(payload));
    expect(parsed.endpoints).toHaveLength(1);
    expect(parsed.gateways).toHaveLength(1);
    expect(parsed.endpoints[0]!.name).toBe("ep1");
    expect(parsed.endpoints[0]!.endpointNumber).toBe("79001112233");
    expect(parsed.endpoints[0]!.data["Регистрационный пароль"]).toBe(
      "secret-pass",
    );
    expect(parsed.gateways[0]!.data["Протокол сигнализации"]).toBe("SIP");
  });

  it("rejects missing arrays", () => {
    expect(() => parsePhonesStdout(JSON.stringify({ version: 1 }))).toThrow(
      /endpoints\[\]/,
    );
  });

  it("allows empty snapshot", () => {
    const parsed = parsePhonesStdout(
      JSON.stringify({
        version: 1,
        endpointCount: 0,
        gatewayCount: 0,
        endpoints: [],
        gateways: [],
      }),
    );
    expect(parsed.endpoints).toEqual([]);
    expect(parsed.gateways).toEqual([]);
  });

  it("merges required fields when endpointHeaders are partial", () => {
    const parsed = parsePhonesStdout(
      JSON.stringify({
        version: 1,
        endpointHeaders: ["Название"],
        gatewayHeaders: [],
        endpoints: [
          {
            Название: "ep-partial",
            "Номер оконечного оборудования": "79001110000",
            Регистрация: "Да",
          },
        ],
        gateways: [],
      }),
    );
    expect(parsed.endpoints).toHaveLength(1);
    expect(parsed.endpoints[0]!.endpointNumber).toBe("79001110000");
    expect(parsed.endpoints[0]!.data["Регистрация"]).toBe("Да");
    expect(parsed.endpointHeaders).toContain("Номер оконечного оборудования");
    expect(parsed.endpointHeaders).toContain("Регистрация");
  });

  it("rejects U+FFFD corruption", () => {
    expect(() =>
      parsePhonesStdout(
        JSON.stringify({
          version: 1,
          endpoints: [{ ...sampleEndpoint, Название: "bad\uFFFDname" }],
          gateways: [],
        }),
      ),
    ).toThrow(/U\+FFFD|UTF-8 corruption/i);
  });

  it("rejects empty Регистрация", () => {
    expect(() =>
      parsePhonesStdout(
        JSON.stringify({
          version: 1,
          endpoints: [{ ...sampleEndpoint, Регистрация: "" }],
          gateways: [],
        }),
      ),
    ).toThrow(/Регистрация/);
  });

  it("rejects missing Название", () => {
    expect(() =>
      parsePhonesStdout(
        JSON.stringify({
          version: 1,
          endpoints: [{ ...sampleEndpoint, Название: "  " }],
          gateways: [],
        }),
      ),
    ).toThrow(/Название/);
  });

  it("rejects endpointCount mismatch", () => {
    expect(() =>
      parsePhonesStdout(
        JSON.stringify({
          version: 1,
          endpointCount: 99,
          gatewayCount: 0,
          endpoints: [sampleEndpoint],
          gateways: [],
        }),
      ),
    ).toThrow(/endpointCount mismatch/);
  });
});
