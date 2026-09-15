import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  await redirectLegacyFamily("registry", { params: Promise.resolve({ path: [] }), searchParams });
}
