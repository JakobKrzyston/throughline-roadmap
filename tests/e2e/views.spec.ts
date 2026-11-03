/** Smoke test: the product and technical views load for the Acme Analytics demo project. */
import { expect, test } from "@playwright/test";

// Requirement and outcome keys, and issue or pull request numbers.
const TICKET_NUMBER = /\b(?:TL|OUT)-\d+\b|#\d+/;

test("product view explains the product in plain language", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics");

  await expect(
    page.getByRole("heading", { name: "Product roadmap" }),
  ).toBeVisible();
  const exportCard = page.getByRole("article", {
    name: "Customers can export reports to Excel and CSV",
  });
  await expect(exportCard.getByText("Partially available")).toBeVisible();
  await expect(
    exportCard.getByText("Customers can now download any report as CSV."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What changed this week" }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(TICKET_NUMBER);

  await page.getByRole("link", { name: "Show technical detail" }).click();
  await expect(exportCard.getByText("TL-3")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Hide technical detail" }),
  ).toBeVisible();
});

test("technical view shows the requirement tree and split history", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/tech");

  await expect(
    page.getByRole("heading", { name: "Technical roadmap" }),
  ).toBeVisible();
  // Leaves start closed; opening one shows its linked pull requests.
  const queue = page.getByText("Background job queue", { exact: true });
  await expect(queue).toBeVisible();
  await queue.click();
  await expect(
    page.getByRole("link", { name: "Add background job queue" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Split history" }),
  ).toBeVisible();
});

test("an unknown project gets a plain-language message", async ({ page }) => {
  await page.goto("/p/no-such-project");

  await expect(
    page.getByRole("heading", { name: "We could not find that project" }),
  ).toBeVisible();
});
