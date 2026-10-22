import { afterEach, describe, expect, it, vi } from "vitest";
import { usernameSchema, profileSchema, readUsernameDraft, saveUsernameDraft, clearUsernameDraft } from "./profile";

afterEach(() => vi.unstubAllGlobals());

describe("username validation and pending verification", () => {
  it("normalizes names and rejects invalid or impersonated profile input", () => {
    expect(usernameSchema.parse("  Minh_Anh  ")).toBe("minh_anh");
    for (const value of ["ab", "123abc", "tên", "a-b", "a".repeat(25)]) {
      expect(usernameSchema.safeParse(value).success).toBe(false);
    }
    expect(profileSchema.safeParse({ username: "valid", user_id: "other-user" }).success).toBe(false);
  });

  it("restores a draft only for the same email and never persists password fields", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    saveUsernameDraft(" Student@School.vn ", "My_Name");
    expect(readUsernameDraft("student@school.vn")).toBe("my_name");
    expect(readUsernameDraft("another@school.vn")).toBe("");
    clearUsernameDraft("another@school.vn");
    expect(readUsernameDraft("student@school.vn")).toBe("my_name");
    const saved = JSON.parse([...values.values()][0]);
    expect(Object.keys(saved).sort()).toEqual(["email", "username"]);
    clearUsernameDraft("student@school.vn");
    expect(readUsernameDraft("student@school.vn")).toBe("");
  });

  it("does not prevent onboarding when browser storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("Blocked"); },
      setItem: () => { throw new Error("Blocked"); },
    });
    expect(() => saveUsernameDraft("student@school.vn", "valid_name")).not.toThrow();
    expect(readUsernameDraft("student@school.vn")).toBe("");
  });
});
