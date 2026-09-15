import { redirect } from "next/navigation";
import { resolveAreaIdentifier } from "@/lib/server/area-resolver";
import { resolveRecord } from "@/lib/server/registry";
import {
  searchTargets,
  searchTargetRoute,
  type ResolveMatch,
} from "@/features/officer/shared/search-targets";
import RetainedRegister from "@/features/officer/register/RetainedRegister";
export default async function Page({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const matches = await resolveAreaIdentifier(identifier);
  const targets = matches.matches
    .flatMap((match) => searchTargets(match as unknown as ResolveMatch))
    .filter((t) => t.kind === "building");
  const unique = [...new Map(targets.map((t) => [t.id, t])).values()];
  if (unique.length === 1) redirect(searchTargetRoute(unique[0], "register"));
  if (unique.length > 1)
    redirect(`/register?q=${encodeURIComponent(identifier)}`);
  const { record, site } = await resolveRecord(identifier);
  return (
    <RetainedRegister key={record.id} siteId={site.id} recordId={record.id} />
  );
}
