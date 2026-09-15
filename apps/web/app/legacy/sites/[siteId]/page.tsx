import RegistryWorkbench from "@/components/RegistryWorkbench";
export default async function Page({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  return <RegistryWorkbench initialSiteId={(await params).siteId} />;
}
