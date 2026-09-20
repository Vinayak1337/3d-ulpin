import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ params, searchParams }: {
  params: Promise<{ areaId: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { areaId } = await params;
  await redirectLegacyFamily("blocks", { params: Promise.resolve({ path: [areaId] }), searchParams });
}
