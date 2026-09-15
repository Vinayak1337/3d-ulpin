"use client";
import { ErrorState } from "@/features/officer/shared/ui";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main style={{ padding: 24 }}>
      <ErrorState
        message="This view could not be opened. Your saved sources and records are unchanged."
        retry={reset}
      />
    </main>
  );
}
