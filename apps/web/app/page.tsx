import { redirect } from "next/navigation";
import { rootPresentationUrl, type RouteSearchParams } from "@/lib/legacy-url";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RouteSearchParams>;
}) {
  const query=await searchParams;
  // Historical case/data URLs retain their existing resolver; the plain entry opens City Studio.
  redirect(Object.keys(query).length?rootPresentationUrl(query):'/studio');
}
