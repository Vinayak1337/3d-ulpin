import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ params, searchParams }: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { caseId } = await params;
  await redirectLegacyFamily("workspace", { params: Promise.resolve({ path: [caseId] }), searchParams });
}
