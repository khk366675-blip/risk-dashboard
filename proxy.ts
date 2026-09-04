import { NextResponse, type NextRequest } from 'next/server';
import { mobileSessionCookie } from '@/lib/mobile-session-token';

export function proxy(request: NextRequest) {
  if (process.env.DASHBOARD_MODE !== 'mobile') return NextResponse.next();
  const path = request.nextUrl.pathname;
  const publicMobile =
    path === '/mobile/login' || path === '/api/mobile/auth/login';
  if (publicMobile) return NextResponse.next();
  if (!path.startsWith('/mobile') && !path.startsWith('/api/mobile')) {
    if (path.startsWith('/api/'))
      return NextResponse.json(
        { error: '이 배포에서는 로컬 실행 기능을 제공하지 않습니다.' },
        { status: 404 },
      );
    return NextResponse.redirect(new URL('/mobile', request.url));
  }
  if (!request.cookies.has(mobileSessionCookie)) {
    if (path.startsWith('/api/mobile'))
      return NextResponse.json({ error: '모바일 로그인이 필요합니다.' }, { status: 401 });
    return NextResponse.redirect(new URL('/mobile/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|og.png).*)'],
};
