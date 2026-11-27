import { expect } from "e2e";

import { test, WEB } from "./t3.ts";

test(
  "The Boring sidebar switch is read-only while a project is selected",
  WEB,
  async ({ t3, app, browser, screen }) => {
    await t3.project("demo");
    await t3.open("/settings/labs");

    await screen.getByRole("switch", "Boring sidebar (group by project)").check();

    await screen.getByRole("button", "Project scope: All projects").tap();
    await screen.getByRole("menuitemradio").filter({ hasText: "demo" }).tap();
    await expect(screen.getByRole("button", "Project scope: demo")).toBeVisible();
    await app.screenshot("project-selected");

    await expect(
      browser.locator('[inert] [aria-label="Boring sidebar (group by project)"]'),
    ).toBeVisible();
  },
);
