import { chromium } from "@playwright/test";

// Prefer Playwright's bundled Chromium; fall back to an installed Chrome/Edge.
export async function launch() {
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* try the next one */
    }
  }
  throw new Error("No browser found: run `npx playwright install chromium`");
}
