import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ params, searchParams }: {
  params: Promise<{ buildingId: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { buildingId } = await params;
  await redirectLegacyFamily("properties", { params: Promise.resolve({ path: [buildingId,'register'] }), searchParams });
}
