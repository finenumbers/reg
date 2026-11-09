import Link from "next/link";
import { requirePagePermission } from "@/modules/auth/guards";
import { hasPermission } from "@/modules/rbac/permissions";
import { getDomainCard } from "@/modules/vats/service";
import { DomainCard } from "@/modules/vats/ui/domain-card";

export const dynamic = "force-dynamic";

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function VatsDomainPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const ctx = await requirePagePermission("vats:read");
  const { domain } = await params;
  const result = await getDomainCard(decodeName(domain));
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          <Link href="/vats" className="hover:underline">
            К списку доменов
          </Link>
        </p>
        <p className="text-destructive text-sm">{result.error}</p>
      </div>
    );
  }
  return (
    <DomainCard
      initial={result.card}
      canWrite={hasPermission(ctx.authz.permissions, "vats:write")}
    />
  );
}
