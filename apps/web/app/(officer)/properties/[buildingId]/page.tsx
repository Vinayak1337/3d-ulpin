import { redirect } from "next/navigation";
import { withRouteQuery, type RouteSearchParams } from "@/lib/legacy-url";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ buildingId: string }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { buildingId } = await params;
  redirect(
    withRouteQuery(
      `/properties/${encodeURIComponent(buildingId)}/register`,
      await searchParams,
    ),
  );
}
