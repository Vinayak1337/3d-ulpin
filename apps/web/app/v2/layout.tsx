import { Suspense, type ReactNode } from "react";
import Shell from "@/features/v2/shared/Shell";
export const metadata = { title: "3D ULPIN V2 · Property intelligence" };
export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
