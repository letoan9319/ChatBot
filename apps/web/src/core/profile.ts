import { z } from "zod";

export const USERNAME_HELP =
  "3–24 ký tự, gồm chữ cái không dấu, số và dấu gạch dưới; bắt đầu bằng chữ cái.";
export const usernameSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z][a-z0-9_]{2,23}$/, USERNAME_HELP);
export const profileSchema = z.object({ username: usernameSchema }).strict();

const DRAFT_KEY = "learnstep-username-draft";
const normalizedEmail = (email: string) => email.trim().toLowerCase();

export function readUsernameDraft(email: string): string {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (value?.email === normalizedEmail(email)) {
      const parsed = usernameSchema.safeParse(value.username);
      if (parsed.success) return parsed.data;
    }
  } catch { /* Storage may be unavailable. */ }
  return "";
}

export function saveUsernameDraft(email: string, username: string) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      email: normalizedEmail(email), username: usernameSchema.parse(username),
    }));
  } catch { /* The user can re-enter the name after verification. */ }
}

export function clearUsernameDraft(email: string) {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (value?.email === normalizedEmail(email)) localStorage.removeItem(DRAFT_KEY);
  } catch { /* No draft needs to be removed. */ }
}
