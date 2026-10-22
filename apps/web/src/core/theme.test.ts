import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { savedTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

describe("theme before hydration", () => {
  it.each([
    { stored: null, systemDark: false, expected: "light" },
    { stored: null, systemDark: true, expected: "dark" },
    { stored: "light", systemDark: true, expected: "light" },
    { stored: "dark", systemDark: false, expected: "dark" },
    { stored: "invalid", systemDark: true, expected: "dark" },
  ])("applies $expected for saved=$stored, systemDark=$systemDark", ({ stored, systemDark, expected }) => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(THEME_INIT_SCRIPT, {
      document,
      localStorage: { getItem: (key: string) => key === THEME_STORAGE_KEY ? stored : null },
      window: { matchMedia: () => ({ matches: systemDark }) },
    });
    expect(document.documentElement.dataset.theme).toBe(expected);
  });

  it("uses the system theme when local storage is blocked", () => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    expect(() => runInNewContext(THEME_INIT_SCRIPT, {
      document,
      localStorage: { getItem: () => { throw new Error("Storage blocked"); } },
      window: { matchMedia: () => ({ matches: true }) },
    })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("accepts only supported saved preferences", () => {
    expect(savedTheme("dark")).toBe("dark");
    expect(savedTheme("light")).toBe("light");
    expect(savedTheme(null)).toBeNull();
    expect(savedTheme("system")).toBeNull();
  });
});
