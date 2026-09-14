import { redirect } from "next/navigation";
import { requirePagePermission } from "@/modules/auth/guards";

export default async function StoragePage() {
  await requirePagePermission("settings:write");
  redirect("/settings#cdr-storage");
}
