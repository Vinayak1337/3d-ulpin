import { NextResponse, type NextRequest } from 'next/server';
import { allowedLoopbackHost } from './lib/server/loopback-host';

// No matcher exclusions: SSR, API, image optimization and public/static derivatives are covered.
export function proxy(request: NextRequest) {
  if (!allowedLoopbackHost(request.headers.get('host'))) {
    return new NextResponse('Forbidden host.', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.next();
}
