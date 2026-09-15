import { redirect } from "next/navigation";
import { rootPresentationUrl, type RouteSearchParams } from "@/lib/legacy-url";

export default async function Home({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  redirect(rootPresentationUrl(await searchParams));
}
