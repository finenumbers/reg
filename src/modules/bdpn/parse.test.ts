import { describe, expect, it } from "vitest";
import {
  BDPN_FIELD_MAX,
  BdpnLookupError,
  acceptedBdpnNumber,
  parseBdpnHtml,
} from "@/modules/bdpn/parse";

const HIT = `<input id="phoneInput" name="num" type="text" value="9994504444">
<div style='text-align:center;margin-top:20px;'>Номер: <b>9994504444</b><br>Оператор: &quot;ВымпелКом&quot; ПАО<br>Территория: Новосибирская область<br>ИНН Оператора: 7713076301</div>`;

function card(fields: {
  number?: string;
  operator?: string;
  territory?: string;
  inn?: string;
  input?: string;
}): string {
  const number = fields.number ?? "9994504444";
  const operator = fields.operator ?? "МТС";
  const territory = fields.territory ?? "Москва";
  const inn = fields.inn ?? "7740000076";
  const input =
    fields.input === undefined
      ? `<input id="phoneInput" name="num" type="text" value="${number}">`
      : fields.input;
  return `${input}
<div>Номер: <b>${number}</b><br>Оператор: ${operator}<br>Территория: ${territory}<br>ИНН Оператора: ${inn}</div>`;
}

describe("acceptedBdpnNumber", () => {
  it("keeps a 10-digit number whose first digit is 3, 4, 8, or 9", () => {
    expect(acceptedBdpnNumber("9994504444")).toBe("9994504444");
    expect(acceptedBdpnNumber(" 3123456789 ")).toBe("3123456789");
    expect(acceptedBdpnNumber("4123456789")).toBe("4123456789");
    expect(acceptedBdpnNumber("8123456789")).toBe("8123456789");
  });

  it("rejects a leading 7 and any other shape", () => {
    expect(acceptedBdpnNumber("79994504444")).toBeNull();
    expect(acceptedBdpnNumber("89994504444")).toBeNull();
    expect(acceptedBdpnNumber("+79994504444")).toBeNull();
    expect(acceptedBdpnNumber("999450444")).toBeNull();
    expect(acceptedBdpnNumber("999 450 4444")).toBeNull();
    expect(acceptedBdpnNumber("2123456789")).toBeNull();
    expect(acceptedBdpnNumber("")).toBeNull();
  });
});

describe("parseBdpnHtml", () => {
  it("reads the live card for 9994504444", () => {
    expect(parseBdpnHtml(HIT, "9994504444")).toEqual({
      found: true,
      number: "9994504444",
      operator: '"ВымпелКом" ПАО',
      territory: "Новосибирская область",
      inn: "7713076301",
    });
  });

  it("decodes a 12-digit INN and a br slash", () => {
    const html = `Номер: 8123456789<br/>Оператор: &amp; Т2<br/>Территория: &#1052;&#1086;&#1089;&#1082;&#1074;&#1072;<br/>ИНН Оператора: 500100732259`;
    expect(parseBdpnHtml(html, "8123456789")).toEqual({
      found: true,
      number: "8123456789",
      operator: "& Т2",
      territory: "Москва",
      inn: "500100732259",
    });
  });

  it("treats an echoed form without a card as a miss", () => {
    const html = `<p>Сервис проверки номера</p>
<input id="phoneInput" style="text-align: center; background:
          linear-gradient(white, white);"
        name="num" type="text" value="9000000000" placeholder="">
<div id="numResultsContainer"></div>
</body></html>`;
    expect(parseBdpnHtml(html, "9000000000")).toEqual({
      found: false,
      number: "9000000000",
    });
  });

  it("rejects a finished form that has no result shell", () => {
    const html = `<input id="phoneInput" value="9000000000"></html>`;
    expect(() => parseBdpnHtml(html, "9000000000")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
  });

  it("rejects a card for a different number", () => {
    expect(() => parseBdpnHtml(card({ number: "9000000000" }), "9994504444")).toThrow(
      BdpnLookupError,
    );
    expect(() => parseBdpnHtml(card({ number: "9000000000" }), "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
  });

  it("rejects an empty operator, a long field, and a tag in the name", () => {
    expect(() => parseBdpnHtml(card({ operator: "   " }), "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    expect(() =>
      parseBdpnHtml(card({ territory: "А".repeat(BDPN_FIELD_MAX + 1) }), "9994504444"),
    ).toThrow(expect.objectContaining({ code: "BAD_RESPONSE" }));
    expect(() => parseBdpnHtml(card({ operator: "A&lt;b&gt;" }), "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
  });

  it("keeps a field at the length cap", () => {
    const territory = "А".repeat(BDPN_FIELD_MAX);
    expect(parseBdpnHtml(card({ territory }), "9994504444")).toMatchObject({
      found: true,
      territory,
    });
  });

  it("rejects two cards, a truncated card, and a foreign page", () => {
    expect(() => parseBdpnHtml(`${card({})}\n${card({})}`, "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    const truncated = `<input id="phoneInput" value="9994504444">Номер: <b>9994504444</b>`;
    expect(() => parseBdpnHtml(truncated, "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    const cutOff = `<input id="phoneInput" value="9994504444"><div id="numResultsContainer"></div>`;
    expect(() => parseBdpnHtml(cutOff, "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
    expect(() => parseBdpnHtml("<html>login</html>", "9994504444")).toThrow(
      expect.objectContaining({ code: "BAD_RESPONSE" }),
    );
  });

  it("rejects a number the form does not accept", () => {
    expect(() => parseBdpnHtml(HIT, "79994504444")).toThrow(
      expect.objectContaining({ code: "INVALID" }),
    );
  });
});
