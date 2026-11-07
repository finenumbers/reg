import { describe, expect, it } from "vitest";
import {
  geographyAbcText,
  geographyDigitMarks,
  type DigitMark,
} from "@/modules/rtu/abc-display";

function hitText(marks: DigitMark[]): string {
  return marks
    .filter((mark) => mark.hit)
    .map((mark) => mark.text)
    .join("");
}

function expectPlainDecorations(marks: DigitMark[]) {
  for (const mark of marks) {
    if (mark.hit) expect(mark.text).not.toMatch(/[ ()]/);
  }
}

describe("geography ABC text", () => {
  it("moves one leading 7 outside the parentheses", () => {
    expect(geographyAbcText("73915512345", "739155", "12345")).toBe("7 (39155)");
    expect(geographyAbcText("74232234567", "7423", "2234567")).toBe("7 (423)");
    expect(geographyAbcText("77001234567", "77", "001234567")).toBe("7 (7)");
    expect(geographyAbcText("7", "7", "")).toBe("7");
    expect(geographyAbcText("79001234567", "79", "001234567")).toBe("7 (9)");
  });

  it("wraps a mobile DEF code that already dropped the country digit", () => {
    expect(geographyAbcText("79039039900", "903", "9039900")).toBe("7 (903)");
  });

  it("leaves another country and an 8-prefix as stored", () => {
    expect(geographyAbcText("3804412345", "380", "4412345")).toBe("380");
    expect(geographyAbcText("83915512345", "839155", "12345")).toBe("839155");
  });

  it("leaves a tariff code that does not rebuild the number", () => {
    expect(geographyAbcText("84232234567", "74232", "")).toBe("74232");
    expect(geographyAbcText("73915512345", "", "")).toBe("");
  });
});

describe("geography search marks", () => {
  it("paints a query that crosses ABC and the local number", () => {
    const marks = geographyDigitMarks("74232234567", "7423", "2234567", "4232");
    expect(hitText(marks.abc)).toBe("423");
    expect(hitText(marks.telephone)).toBe("2");
    expectPlainDecorations([...marks.abc, ...marks.telephone]);
  });

  it("paints both non-overlapping copies and only the left overlapping one", () => {
    const both = geographyDigitMarks("79039039900", "903", "9039900", "903");
    expect(hitText(both.abc)).toBe("903");
    expect(hitText(both.telephone)).toBe("903");
    const left = geographyDigitMarks("79039039900", "903", "9039900", "9039");
    expect(hitText(left.abc)).toBe("903");
    expect(hitText(left.telephone)).toBe("9");
    expectPlainDecorations([
      ...both.abc,
      ...both.telephone,
      ...left.abc,
      ...left.telephone,
    ]);
  });

  it("does not paint a tariff code that is not part of the number", () => {
    const marks = geographyDigitMarks("84232234567", "74232", "", "423");
    expect(marks.abc.every((mark) => !mark.hit)).toBe(true);
    expect(marks.telephone.every((mark) => !mark.hit)).toBe(true);
  });

  it("keeps the same digits when the number has a leading space", () => {
    const plain = geographyDigitMarks("74232234567", "7423", "2234567", "4232");
    const padded = geographyDigitMarks(" 74232234567", "7423", "2234567", "4232");
    expect(padded.abc).toEqual(plain.abc);
    expect(padded.telephone).toEqual(plain.telephone);
  });

  it("does not throw on a query made of search metacharacters", () => {
    for (const query of ["(", "*", "\\"]) {
      const marks = geographyDigitMarks("74232234567", "7423", "2234567", query);
      expect(marks.abc.every((mark) => !mark.hit)).toBe(true);
      expect(marks.telephone.every((mark) => !mark.hit)).toBe(true);
    }
  });

  it("leaves every digit unmarked when the query is blank", () => {
    const marks = geographyDigitMarks("73915512345", "739155", "12345", "  ");
    expect(geographyAbcText("73915512345", "739155", "12345")).toBe("7 (39155)");
    expect(marks.abc.map((mark) => mark.text).join("")).toBe("7 (39155)");
    expect(marks.abc.every((mark) => !mark.hit)).toBe(true);
    expect(marks.telephone.every((mark) => !mark.hit)).toBe(true);
  });
});
