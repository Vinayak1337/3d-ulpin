import { Suspense, type ReactNode } from "react";
import Shell from "@/features/officer/shared/Shell";
export const metadata = { title: "3D ULPIN · Property intelligence" };
export default function OfficerLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
