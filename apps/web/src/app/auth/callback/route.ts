import { NextRequest, NextResponse } from "next/server";
import { callbackDestination } from "@/core/auth-flow";
import { sessionClient } from "@/core/supabase-server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const type = request.nextUrl.searchParams.get("type");
  if (code) {
    const db = await sessionClient();
    const { data, error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirectType = (data as { redirectType?: string | null } | null)
        ?.redirectType;
      const destination = callbackDestination({
        next,
        type,
        redirectType,
      });
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }
  return NextResponse.redirect(
    new URL("/auth?error=verification", request.url),
  );
}
