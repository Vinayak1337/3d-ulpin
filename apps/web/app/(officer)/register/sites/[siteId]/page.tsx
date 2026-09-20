import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ params, searchParams }: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { siteId } = await params;
  await redirectLegacyFamily("register", { params: Promise.resolve({ path: ['sites',siteId] }), searchParams });
}
