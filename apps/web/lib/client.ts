import type {
  ApiError,
  CaseDetail,
  CaseRecord,
  PlanCalibration,
  Point2,
  ProcessingJob,
  SourceProfile,
  SourceRevision,
  UnitSpec,
} from "@ulpin/contracts";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    cache: "no-store",
    ...options,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as ApiError | null;
    throw new Error(
      error?.error?.message ||
        `Request failed (${response.status}). Please try again.`,
    );
  }
  return body as T;
}
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const api = {
  cases: () => request<CaseRecord[]>("/cases"),
  createCase: (name: string) =>
    request<CaseRecord>(
      "/cases",
      json({
        name,
        description:
          "Local demonstration workspace. Synthetic inputs are not survey evidence.",
      }),
    ),
  detail: (id: string) => request<CaseDetail>(`/cases/${id}`),
  demo: (id: string, dataset: "c001" | "c002") =>
    request<{ sourceIds: string[] }>(`/cases/${id}/demo-inputs`, {
      ...json({ dataset }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `demo-${id}-${dataset}`,
      },
    }),
  demoLevels: (id: string, dataset: "c001" | "c002") =>
    request<SourceRevision>(`/cases/${id}/demo-levels`, json({ dataset })),
  upload: async (
    id: string,
    file: File,
    profile: SourceProfile,
    familyId?: string,
  ) => {
    const body = new FormData();
    body.append("file", file);
    body.append("profile", profile);
    if (familyId) body.append("familyId", familyId);
    return request<SourceRevision>(`/cases/${id}/sources`, {
      method: "POST",
      body,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
  },
  prepare: (
    id: string,
    spatialSourceId: string,
    levelSourceId?: string,
    controlSourceId?: string,
  ) =>
    request<CaseDetail>(
      `/cases/${id}/prepare`,
      json({ spatialSourceId, levelSourceId, controlSourceId }),
    ),
  applyLevels: (id: string, sourceId: string, expectedRevision: number) =>
    request<CaseDetail>(
      `/cases/${id}/apply-levels`,
      json({ sourceId, expectedRevision }),
    ),
  editUnit: (
    id: string,
    unitId: string,
    patch: {
      expectedRevision: number;
      lower?: number;
      upper?: number;
      footprint?: Point2[];
      calibration?: PlanCalibration;
    },
  ) => request<UnitSpec>(`/cases/${id}/units/${unitId}`, json(patch, "PATCH")),
  addUnit: (
    id: string,
    unit: {
      alias: string;
      name: string;
      kind: UnitSpec["kind"];
      footprint: Point2[];
      lower: number;
      upper: number;
      levelLabel?: string;
      calibration?: PlanCalibration;
    },
  ) => request<UnitSpec>(`/cases/${id}/units`, json(unit)),
  build: (id: string, expectedRevision: number) =>
    request<ProcessingJob>(`/cases/${id}/build`, json({ expectedRevision })),
  retry: (jobId: string) =>
    request<ProcessingJob>(`/jobs/${jobId}/retry`, { method: "POST" }),
  health: () =>
    request<{ ok: boolean; services: Record<string, boolean> }>("/health"),
};
export const sourceUrl = (id: string) => `/api/v1/sources/${id}/file`;
