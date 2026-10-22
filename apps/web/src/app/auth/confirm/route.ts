import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sessionClient } from "@/core/supabase-server";

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (hash && ["signup", "recovery", "email"].includes(type || "")) {
    const db = await sessionClient();
    const { error } = await db.auth.verifyOtp({
      token_hash: hash,
      type: type as EmailOtpType,
    });
    if (!error)
      return NextResponse.redirect(
        new URL(
          type === "recovery" ? "/auth?mode=reset" : "/study",
          request.url,
        ),
      );
  }
  return NextResponse.redirect(
    new URL("/auth?error=verification", request.url),
  );
}
