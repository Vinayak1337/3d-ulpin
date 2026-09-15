import { Suspense } from "react";
import RegisterPage from "@/features/v2/register/RegisterPage";
export default async function Page({
  params,
}: {
  params: Promise<{ buildingId: string }>;
}) {
  const { buildingId } = await params;
  return (
    <Suspense fallback={<p role="status">Opening property register…</p>}>
      <RegisterPage key={buildingId} buildingId={buildingId} />
    </Suspense>
  );
}
