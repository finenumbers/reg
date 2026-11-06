import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseActivationBody,
  catalogDisplayTitle,
  catalogSpaceTrim,
  changeEndpointActivation,
} from "@/modules/phones/activation";
import type { ActivationDeps, ActivationRequest } from "@/modules/phones/activation";
import type { ActivationWriteAttempt } from "@/modules/phones/activation-write";
import type { EquipmentIdentity } from "@/modules/phones/rtu-rows";
import type { EquipmentRead } from "@/modules/phones/rtu-read";
import { STATUS_ACTIVE, STATUS_BLOCKED } from "@/modules/phones/types";
import { sendActivationUpdate } from "@/modules/phones/activation-write";

function identity(rawActive: string, pk = "15"): EquipmentIdentity {
  const active = rawActive === "1";
  return {
    pk,
    kind: "endpoint",
    name: "EP",
    number: "74951234567",
    rawActive,
    activation: active ? STATUS_ACTIVE : STATUS_BLOCKED,
    endpoint: {
      Название: "EP",
      "Номер оконечного оборудования": "74951234567",
      "Регистрационный пароль": "secret",
      Статус: active ? STATUS_ACTIVE : STATUS_BLOCKED,
    },
  };
}

function read(
  rows: EquipmentIdentity[],
  ctl = "checkbox",
  action: number | null = 2,
): EquipmentRead {
  return {
    ok: true,
    payload: {
      version: 2,
      endpointHeaders: [],
      gatewayHeaders: [],
      endpoints: [],
      gateways: [],
    },
    identities: rows,
    objectId: "02.2201.01",
    pkColumn: "gateway_id",
    activeColumn: {
      name: "enable",
      ctlType: ctl,
      action,
      actionUnreadable: false,
    },
  };
}

function deps(overrides: Partial<ActivationDeps> = {}): ActivationDeps {
  const write = vi.fn(async (): Promise<ActivationWriteAttempt> => ({
    sent: true,
    count: 1,
    fault: null,
  }));
  const sync = vi.fn(async () => ({
    jobRunId: "job-1",
    status: "success" as const,
    errorMessage: null,
    phonesParsed: 1,
    endpointCount: 1,
    gatewayCount: 0,
    exitCode: null,
    identities: [identity("0")],
  }));
  return {
    occupy: async (run) => ({ accepted: true as const, value: await run() }),
    loadEndpoint: async () => ({
      id: "row-1",
      name: "EP",
      endpointNumber: "74951234567",
      data: { Статус: STATUS_ACTIVE },
    }),
    countTwins: async () => 0,
    read: async () => read([identity("1")]),
    write,
    sync,
    loadByNumber: vi.fn(async () => []),
    audit: vi.fn(async () => {}),
    ...overrides,
  };
}

function ask(patch: Partial<ActivationRequest> = {}): ActivationRequest & { actorUserId: string } {
  return {
    endpointId: "row-1",
    phone: "74951234567",
    activation: STATUS_ACTIVE,
    title: "EP",
    actorUserId: "user-1",
    ...patch,
  };
}

describe("parseActivationBody", () => {
  it("accepts the screen status and title and rejects a target status", () => {
    expect(
      parseActivationBody({
        endpointId: "row-1",
        phone: " 7495 ",
        activation: ` ${STATUS_ACTIVE} `,
        title: " EP ",
      }),
    ).toEqual({
      endpointId: "row-1",
      phone: "7495",
      activation: STATUS_ACTIVE,
      title: "EP",
    });
    expect(
      "error" in
        parseActivationBody({
          endpointId: "row-1",
          phone: "1",
          activation: STATUS_ACTIVE,
          title: "EP",
          status: "0",
        }),
    ).toBe(true);
    expect(
      "error" in
        parseActivationBody({
          endpointId: "row-1",
          phone: "1",
          activation: "0",
          title: "EP",
        }),
    ).toBe(true);
  });
});

describe("catalogDisplayTitle", () => {
  it("follows the geography list and keeps a non-breaking space", () => {
    expect(catalogDisplayTitle("EP", { Название: "  Line  " })).toBe("Line");
    expect(catalogDisplayTitle("  EP  ", { Название: "   " })).toBe("EP");
    expect(catalogDisplayTitle("EP", {})).toBe("EP");
    expect(catalogSpaceTrim("\u00a0EP")).toBe("\u00a0EP");
  });
});

describe("changeEndpointActivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not write when the typed number differs", async () => {
    const used = deps();
    const result = await changeEndpointActivation(ask({ phone: "7000" }), used);
    expect(result.ok).toBe(false);
    expect(used.write).not.toHaveBeenCalled();
    expect(used.sync).not.toHaveBeenCalled();
    expect(used.loadByNumber).not.toHaveBeenCalled();
  });

  it("does not write without the update bit or a checkbox", async () => {
    const blocked = deps({ read: async () => read([identity("1")], "checkbox", 1) });
    const result = await changeEndpointActivation(ask(), blocked);
    expect(result.ok).toBe(false);
    expect(blocked.write).not.toHaveBeenCalled();

    const text = deps({ read: async () => read([identity("1")], "textbox", 2) });
    await changeEndpointActivation(ask(), text);
    expect(text.write).not.toHaveBeenCalled();
  });

  it("does not write when two live rows match", async () => {
    const used = deps({
      read: async () => read([identity("1", "15"), identity("1", "16")]),
    });
    const result = await changeEndpointActivation(ask(), used);
    expect(result.ok).toBe(false);
    expect(used.write).not.toHaveBeenCalled();
  });

  it("writes once and confirms the flipped flag", async () => {
    const used = deps();
    const result = await changeEndpointActivation(ask(), used);
    expect(result.ok).toBe(true);
    expect(result.message).toContain(STATUS_BLOCKED);
    expect(used.write).toHaveBeenCalledTimes(1);
    expect(vi.mocked(used.write).mock.calls[0]?.[0]).toMatchObject({
      objectId: "02.2201.01",
      pkName: "gateway_id",
      pkValue: "15",
      activeName: "enable",
      activeValue: "0",
    });
    expect(used.sync).toHaveBeenCalledTimes(1);
  });

  it("does not write again when another row changed", async () => {
    const other = { ...identity("1", "16"), number: "74950000000", name: "Other" };
    const used = deps({
      read: async () => read([identity("1", "15"), other]),
      sync: vi.fn(async () => ({
        jobRunId: "job-1",
        status: "success" as const,
        errorMessage: null,
        phonesParsed: 2,
        endpointCount: 2,
        gatewayCount: 0,
        exitCode: null,
        identities: [identity("0", "15"), { ...other, rawActive: "0" }],
      })),
    });
    const result = await changeEndpointActivation(ask(), used);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("не только у этого номера");
    expect(used.write).toHaveBeenCalledTimes(1);
    expect(used.sync).toHaveBeenCalledTimes(1);
  });

  it("refuses while phones.sync is in flight", async () => {
    const used = deps({
      occupy: async () => ({ accepted: false as const }),
    });
    const result = await changeEndpointActivation(ask(), used);
    expect(result.busy).toBe(true);
    expect(used.write).not.toHaveBeenCalled();
    expect(used.loadByNumber).not.toHaveBeenCalled();
  });

  it("does not sync when the binding is rejected", async () => {
    const used = deps({
      write: vi.fn(async () => ({
        sent: false as const,
        detail: "Схема записи не разобрана.",
      })),
    });
    const result = await changeEndpointActivation(ask(), used);
    expect(result.ok).toBe(false);
    expect(used.sync).not.toHaveBeenCalled();
  });

  it("resolves a replaced catalog id when the screen still matches", async () => {
    const used = deps({
      loadEndpoint: async () => null,
      loadByNumber: vi.fn(async () => [
        {
          id: "row-new",
          name: "EP",
          endpointNumber: "74951234567",
          data: { Статус: STATUS_ACTIVE, Название: " EP " },
        },
      ]),
    });
    const result = await changeEndpointActivation(ask(), used);
    expect(result.ok).toBe(true);
    expect(used.write).toHaveBeenCalledTimes(1);
    expect(vi.mocked(used.audit).mock.calls.at(-1)?.[2]).toBe("row-new");
  });

  it("does not write when the replaced row has another status or title", async () => {
    const otherStatus = deps({
      loadEndpoint: async () => null,
      loadByNumber: async () => [
        {
          id: "row-new",
          name: "EP",
          endpointNumber: "74951234567",
          data: { Статус: STATUS_BLOCKED, Название: "EP" },
        },
      ],
    });
    const statusResult = await changeEndpointActivation(ask(), otherStatus);
    expect(statusResult.ok).toBe(false);
    expect(statusResult.message).toContain("изменилась");
    expect(otherStatus.write).not.toHaveBeenCalled();

    const otherTitle = deps({
      loadEndpoint: async () => null,
      loadByNumber: async () => [
        {
          id: "row-new",
          name: "EP",
          endpointNumber: "74951234567",
          data: { Статус: STATUS_ACTIVE, Название: "Other" },
        },
      ],
    });
    const titleResult = await changeEndpointActivation(ask(), otherTitle);
    expect(titleResult.ok).toBe(false);
    expect(otherTitle.write).not.toHaveBeenCalled();
  });

  it("does not write when the number is missing or repeated", async () => {
    const missing = deps({ loadEndpoint: async () => null });
    const missingResult = await changeEndpointActivation(ask(), missing);
    expect(missingResult.message).toContain("не найдена");
    expect(missing.write).not.toHaveBeenCalled();

    const many = deps({
      loadEndpoint: async () => null,
      loadByNumber: async () => [
        {
          id: "row-new",
          name: "EP",
          endpointNumber: "74951234567",
          data: { Статус: STATUS_ACTIVE },
        },
        {
          id: "row-other",
          name: "Other",
          endpointNumber: "74951234567",
          data: { Статус: STATUS_ACTIVE },
        },
      ],
    });
    const manyResult = await changeEndpointActivation(ask(), many);
    expect(manyResult.message).toContain("больше одного раза");
    expect(many.write).not.toHaveBeenCalled();
  });
});

describe("sendActivationUpdate", () => {
  it("posts updateRowset once", async () => {
    const bodies: string[] = [];
    const wsdl = `<?xml version="1.0"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
 xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
 xmlns:tns="urn:rtu-api" xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:rtu-api">
  <message name="getObjectsRequest"><part name="p_types" type="xsd:string"/></message>
  <message name="updateRowsetRequest">
    <part name="p_table_hi" type="xsd:string"/>
    <part name="p_rowset" type="xsd:string"/>
    <part name="p_filter" type="xsd:string"/>
  </message>
  <portType name="ApiPort">
    <operation name="getObjects"><input message="tns:getObjectsRequest"/></operation>
    <operation name="updateRowset"><input message="tns:updateRowsetRequest"/></operation>
  </portType>
  <binding name="ApiBinding" type="tns:ApiPort">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="getObjects">
      <soap:operation soapAction="urn:getObjects"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api"/></input>
    </operation>
    <operation name="updateRowset">
      <soap:operation soapAction="urn:updateRowset"/>
      <input><soap:body use="encoded" namespace="urn:rtu-api"/></input>
    </operation>
  </binding>
  <service name="Api"><port name="ApiPort" binding="tns:ApiBinding">
    <soap:address location="https://rtu.example/service/"/>
  </port></service>
</definitions>`;
    const result = await sendActivationUpdate({
      account: {
        origin: "https://rtu.example",
        login: "u",
        password: "secret-pass",
        caPem: null,
      },
      rowPassword: "reg-secret",
      command: {
        objectId: "02.2201.01",
        pkName: "gateway_id",
        pkValue: "15",
        activeName: "enable",
        activeValue: "1",
      },
      exchange: async (input) => {
        if (input.method === "POST") bodies.push(input.body ?? "");
        if (input.url.includes("wsdl")) return { ok: true, status: 200, text: wsdl };
        return {
          ok: true,
          status: 200,
          text: `<?xml version="1.0"?><Envelope><Body><updateRowsetResponse>1</updateRowsetResponse></Body></Envelope>`,
        };
      },
    });
    expect(result).toEqual({ sent: true, count: 1, fault: null });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("updateRowset");
    expect(bodies[0]).not.toContain("insertRowset");
    expect(bodies[0]).toContain(">1</value>");
  });
});
