import { AuthApiError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

describe("account error explanations", () => {
  it("distinguishes missing SMTP from an email quota or disabled signup", () => {
    const smtp = authErrorMessage(new AuthApiError("Email address not authorized", 403, "email_address_not_authorized"));
    const quota = authErrorMessage(new AuthApiError("Rate limit", 429, "over_email_send_rate_limit"));
    const disabled = authErrorMessage(new AuthApiError("Signup disabled", 422, "signup_disabled"));
    expect(smtp).toContain("dịch vụ gửi email");
    expect(quota).toContain("giới hạn");
    expect(disabled).toContain("chưa mở đăng ký");
  });

  it("does not expose database details, secrets or unrecognized server messages", () => {
    const error = { code: "unknown", message: "SQL query with private credentials" };
    expect(authErrorMessage(error)).not.toContain(error.message);
    expect(authErrorMessage({ code: "toString" })).toEqual(authErrorMessage(null));
  });
});
