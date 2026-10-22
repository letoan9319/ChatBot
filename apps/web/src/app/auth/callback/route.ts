import { NextRequest, NextResponse } from "next/server";
import { sessionClient } from "@/core/supabase-server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  if (code) {
    const db = await sessionClient();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error)
      return NextResponse.redirect(
        new URL(next === "/auth?mode=reset" ? next : "/study", request.url),
      );
  }
  return NextResponse.redirect(
    new URL("/auth?error=verification", request.url),
  );
}
