import { Suspense } from "react";
import WorkspacePage from "@/features/officer/workspace/WorkspacePage";
import WorkspaceStart from "@/features/officer/workspace/WorkspaceStart";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const query = await searchParams;
  return (
    <Suspense fallback={<p>Opening plan workspace…</p>}>
      {query.case ? (
        <WorkspacePage key={query.case} caseId={query.case} />
      ) : (
        <WorkspaceStart />
      )}
    </Suspense>
  );
}
