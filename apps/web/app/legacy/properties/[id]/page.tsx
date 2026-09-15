import PropertyPage from "@/components/PropertyPage";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PropertyPage buildingId={id} />;
}
