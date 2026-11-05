/** Smoke test: a roadmap imports from a sample export or an uploaded file, and a bad file is explained. */
import { expect, test } from "@playwright/test";

test("a sample export becomes a proposal in the review queue", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/import");

  await page.getByRole("button", { name: "Jira CSV" }).click();
  await expect(page.getByLabel("Roadmap")).toHaveValue(/^Summary,Issue key/);
  await page.getByRole("button", { name: "Generate proposal" }).click();

  const summary = "Import 3 outcomes and 8 requirements from a pasted roadmap";
  await expect(page.getByText(summary)).toBeVisible();
  await page.getByRole("link", { name: "Review the proposal" }).click();
  const card = page.getByRole("article", { name: summary });
  await expect(
    card.getByText("Customers get their dashboards by email on a schedule"),
  ).toBeVisible();
});

test("an uploaded file becomes a proposal", async ({ page }) => {
  await page.goto("/p/acme-analytics/import");

  await page.getByLabel("Or upload an export").setInputFiles({
    name: "roadmap.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 2027\n\n- Mobile app\n- Anomaly alerts\n"),
  });
  await page.getByRole("button", { name: "Generate proposal" }).click();

  await expect(
    page.getByText("Import 2 outcomes and 5 requirements from roadmap.md"),
  ).toBeVisible();
});

test("an unsupported file gets a clear error and saves nothing", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/import");

  await page.getByLabel("Or upload an export").setInputFiles({
    name: "roadmap.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("PK\u0003\u0004"),
  });
  await page.getByRole("button", { name: "Generate proposal" }).click();

  await expect(
    page.getByText("That file type is not supported."),
  ).toBeVisible();
  await expect(page.getByText("Review the proposal")).toHaveCount(0);
});
