import Workbench from "@/components/Workbench";
import AreaWorkbench from "@/components/AreaWorkbench";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ case?: string }>;
}) {
  const params = await searchParams;
  return params.case ? <Workbench /> : <AreaWorkbench />;
}
