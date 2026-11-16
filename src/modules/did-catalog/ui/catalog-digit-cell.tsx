"use client";

import { HighlightText } from "@/components/highlight-text";
import { catalogDigitPlain } from "@/modules/did-catalog/catalog-digit-text";
import { geographyDigitMarks, type DigitMark } from "@/modules/rtu/abc-display";

function MarkedDigits({ marks }: { marks: DigitMark[] }) {
  return (
    <>
      {marks.map((part, index) =>
        part.hit ? (
          <mark key={index} className="search-hit">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** ABC and the local number, in the same shape as «Управление РТУ». */
export function CatalogDigitCell({
  e164,
  abc,
  number,
  column,
  phoneQ,
}: {
  e164: string;
  abc: string;
  number: string;
  column: "abc" | "number";
  phoneQ?: string;
}) {
  const plain = catalogDigitPlain(column, e164, abc, number);
  if (plain != null) {
    if (column === "number") return <HighlightText text={plain} query={phoneQ} />;
    return <>{plain}</>;
  }
  const marks = geographyDigitMarks(e164, abc, number, phoneQ);
  return <MarkedDigits marks={column === "abc" ? marks.abc : marks.telephone} />;
}
