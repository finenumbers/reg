import { describe, expect, it } from "vitest";
import { parsePhonesStdout } from "@/modules/phones/parser";
import { ENDPOINT_HEADERS, GATEWAY_HEADERS } from "@/modules/phones/types";

describe("parsePhonesStdout", () => {
  it("parses endpoints and gateways with plaintext password", () => {
    const payload = {
      version: 1,
      endpointHeaders: [...ENDPOINT_HEADERS],
      gatewayHeaders: [...GATEWAY_HEADERS],
      endpoints: [
        {
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
        },
      ],
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
      JSON.stringify({ version: 1, endpoints: [], gateways: [] }),
    );
    expect(parsed.endpoints).toEqual([]);
    expect(parsed.gateways).toEqual([]);
  });
});
