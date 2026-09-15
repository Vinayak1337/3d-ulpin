import BlockPage from "@/features/v2/block/BlockPage";
export default async function Page({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = await params;
  return <BlockPage key={areaId} areaId={areaId} />;
}
