import { Field } from '@ulpin/design-system';

export const Search = () => (
  <Field label="3D ULPIN or address" placeholder="e.g. Flat 704, Lake View Residence" help="Search released records by code, parcel ULPIN or address." />
);

export const WithError = () => (
  <Field label="Lower limit (m, SD-1)" defaultValue="238.10" error="Lower limit must be below the upper limit (236.80)." />
);

export const Measurement = () => <Field label="Upper limit (m, SD-1)" defaultValue="236.80" help="From levels-r2.csv row 9." />;
