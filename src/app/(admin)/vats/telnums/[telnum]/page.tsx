import Link from "next/link";
import { requirePagePermission } from "@/modules/auth/guards";
import { getTelnumCard } from "@/modules/vats/service";

export const dynamic = "force-dynamic";

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function showText(value: string | null): string {
  if (!value) return "—";
  if (value.length > 300 || /[\u0000-\u001F\u007F]/.test(value)) return "—";
  return value;
}

export default async function VatsTelnumPage({
  params,
}: {
  params: Promise<{ telnum: string }>;
}) {
  await requirePagePermission("vats:read");
  const { telnum } = await params;
  const result = await getTelnumCard(decodeName(telnum));
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          <Link href="/vats/telnums" className="hover:underline">
            К списку номеров
          </Link>
        </p>
        <p className="text-destructive text-sm">{result.error}</p>
      </div>
    );
  }
  const card = result.card;
  return (
    <div className="h-full space-y-4 overflow-y-auto">
      <div>
        <p className="text-sm">
          <Link href="/vats/telnums" className="hover:underline">
            К списку номеров
          </Link>
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight [text-box:trim-start_cap_alphabetic]">
          {card.telnum}
        </h1>
      </div>
      <dl className="max-w-xl space-y-3 text-sm">
        <div className="grid grid-cols-[14rem_1fr] gap-3">
          <dt className="text-muted-foreground">Назначен домену</dt>
          <dd>{showText(card.allocatedTo)}</dd>
        </div>
        <div className="grid grid-cols-[14rem_1fr] gap-3">
          <dt className="text-muted-foreground">FMC</dt>
          <dd>{card.isFmc == null ? "—" : card.isFmc ? "Да" : "Нет"}</dd>
        </div>
        <div className="grid grid-cols-[14rem_1fr] gap-3">
          <dt className="text-muted-foreground">Шлюзы</dt>
          <dd>{card.gateways.length === 0 ? "—" : card.gateways.join(", ")}</dd>
        </div>
      </dl>
    </div>
  );
}
