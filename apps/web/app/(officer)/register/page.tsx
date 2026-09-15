import { Suspense } from "react";
import RegisterStart from "@/features/officer/register/RegisterStart";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Opening register…</p>}>
      <RegisterStart />
    </Suspense>
  );
}
