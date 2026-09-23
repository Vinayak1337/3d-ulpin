import { handleExternalScene } from '@/lib/server/usp/external-scene';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ areaId: string; featureId: string }> }) {
  const { areaId, featureId } = await context.params;
  return handleExternalScene(request, areaId, featureId);
}
