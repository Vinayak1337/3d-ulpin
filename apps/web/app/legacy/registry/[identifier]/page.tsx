import RegistryWorkbench from "@/components/RegistryWorkbench";
export default async function Page({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  return (
    <RegistryWorkbench
      recordIdentifier={decodeURIComponent((await params).identifier)}
    />
  );
}
