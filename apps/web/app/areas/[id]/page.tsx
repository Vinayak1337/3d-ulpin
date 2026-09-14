import AreaWorkbench from "@/components/AreaWorkbench";
export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ feature?: string; record?: string }>;
}) {
  const [{ id }, { feature, record }] = await Promise.all([
    params,
    searchParams,
  ]);
  return (
    <AreaWorkbench
      initialAreaId={id}
      initialFeatureId={feature}
      initialRecordId={record}
    />
  );
}
