import Workbench from "@/components/Workbench";
import RegistryWorkbench from "@/components/RegistryWorkbench";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const params = await searchParams;
  return params.case ? <Workbench /> : <RegistryWorkbench />;
}
