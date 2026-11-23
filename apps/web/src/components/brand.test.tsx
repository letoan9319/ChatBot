import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Brand } from "./brand";

it("links the workspace brand to study and the public brand to the landing page", () => {
  expect(renderToStaticMarkup(<Brand workspace />)).toContain('href="/study"');
  expect(renderToStaticMarkup(<Brand />)).toContain('href="/"');
});
