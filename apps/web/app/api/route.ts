export function GET() {
  return Response.json(
    {
      service: "3d-ulpin",
      version: "v1",
      api: "/api/v1",
      health: "/api/v1/health",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
