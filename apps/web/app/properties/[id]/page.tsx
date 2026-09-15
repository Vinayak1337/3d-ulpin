import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RouteSearchParams> }) {
  const { id } = await params;
  await redirectLegacyFamily("properties", { params: Promise.resolve({ path: [id] }), searchParams });
}
