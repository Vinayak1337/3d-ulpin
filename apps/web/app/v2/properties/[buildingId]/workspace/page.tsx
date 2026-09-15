import { Suspense } from "react";
import WorkspacePage from "@/features/v2/workspace/WorkspacePage";
export default async function Page({
  params,
}: {
  params: Promise<{ buildingId: string }>;
}) {
  const { buildingId } = await params;
  return (
    <Suspense fallback={<p>Opening property plans…</p>}>
      <WorkspacePage key={buildingId} buildingId={buildingId} />
    </Suspense>
  );
}
