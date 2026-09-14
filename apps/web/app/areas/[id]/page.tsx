import AreaWorkbench from "@/components/AreaWorkbench";
export default async function AreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ feature?: string }>;
}) {
  const [{ id }, { feature }] = await Promise.all([params, searchParams]);
  return <AreaWorkbench initialAreaId={id} initialFeatureId={feature} />;
}
