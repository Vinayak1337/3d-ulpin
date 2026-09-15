import GeometryWorkspace from "@/features/officer/workspace/GeometryWorkspace";
export default async function Page({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return <GeometryWorkspace key={caseId} caseId={caseId} />;
}
