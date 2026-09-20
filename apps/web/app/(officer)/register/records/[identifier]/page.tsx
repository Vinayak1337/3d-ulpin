import { redirectLegacyFamily } from "@/lib/legacy-redirect-page";
import type { RouteSearchParams } from "@/lib/legacy-url";

export default async function Page({ params, searchParams }: {
  params: Promise<{ identifier: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { identifier } = await params;
  await redirectLegacyFamily("register", { params: Promise.resolve({ path: ['records',identifier] }), searchParams });
}
