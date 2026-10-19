// Optimistic route protection only: send visitors without a session cookie to sign-in before
// rendering CMS pages. The real checks are server-side in every page, action and route handler.
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_CMS = [/^\/admin\/sign-in$/, /^\/admin\/setup$/, /^\/admin\/invite\/[^/]+$/];
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-nut_session" : "nut_session";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_CMS.some((re) => re.test(pathname))) return NextResponse.next();
  if (!request.cookies.has(COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/sign-in";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
