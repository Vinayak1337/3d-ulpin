import RetainedRegister from "@/features/officer/register/RetainedRegister";
export default async function Page({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  return <RetainedRegister key={siteId} siteId={siteId} />;
}
