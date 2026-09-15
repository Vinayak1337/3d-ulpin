import WorkspacePage from "@/features/officer/workspace/WorkspacePage";
import { query } from "@/lib/server/db";
export default async function Page({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const binding = await query(
    "SELECT building_id FROM building_preparations WHERE case_id::text=$1",
    [caseId],
  );
  return (
    <WorkspacePage
      key={caseId}
      caseId={caseId}
      buildingId={binding.rows[0]?.building_id}
    />
  );
}
