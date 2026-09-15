import { redirect } from "next/navigation";
import { withRouteQuery, type RouteSearchParams } from "@/lib/legacy-url";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<RouteSearchParams>;
}) {
  const { path = [] } = await params;
  redirect(
    withRouteQuery(
      path.length ? "/" + path.map(encodeURIComponent).join("/") : "/blocks",
      await searchParams,
    ),
  );
}
