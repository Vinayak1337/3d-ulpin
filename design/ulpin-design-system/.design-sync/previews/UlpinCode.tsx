import { UlpinCode } from '@ulpin/design-system';

export const Assigned = () => (
  <UlpinCode code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4" location="MH2507A1B3C4D5 / S01 / F07 / R003" legend />
);

export const Draft = () => <UlpinCode state="draft" location="MULTI(2) / U01 / B1 / P041" />;

export const Retired = () => (
  <UlpinCode state="retired" code="P3-3M8Q0T5W1Y7Z2A4B6C9D-GE" note="Retired 12 Sep 2026 · merged into P3-9F2K…-RS" />
);

export const Compact = () => (
  <UlpinCode code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4" location="MH2507A1B3C4D5 / S01 / F07 / R003" labelled={false} />
);
