/** Smoke test: the review queue counts, explains and confirms decisions on the demo project's proposals. */
import { expect, type Page, test } from "@playwright/test";

// The tests only reject, so the roadmap the other specs check stays as seeded. The customer
// feedback proposal is left alone because the feedback page shows it as waiting.
test.describe.configure({ mode: "serial" });

const waiting = (page: Page) =>
  page.getByRole("region", { name: "Waiting for a decision" });

const card = (page: Page, summary: string) =>
  page.getByRole("article", { name: summary });

test("the queue counts proposals by kind and shows them plainly", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/review");

  await expect(waiting(page)).toContainText(
    "5 proposals are waiting for a decision",
  );
  const kinds = waiting(page).getByRole("list", { name: "By kind" });
  for (const kind of [
    "Target at risk: 1",
    "Roadmap import: 1",
    "Customer feedback: 1",
    "Planned vs. shipped: 1",
    "Suggested link: 1",
  ]) {
    await expect(kinds.getByText(kind)).toBeVisible();
  }

  // The outcome's name, not its key, and an explicit date.
  const feedback = card(
    page,
    'Count feedback "Can I send a dashboard to a client who has no account?" towards “Customers can share a dashboard with a link”',
  );
  await expect(feedback).toBeVisible();
  await expect(feedback.locator("time")).toHaveText(
    /^\d{1,2} [A-Z][a-z]+ \d{4}$/,
  );

  // A new requirement lists only the fields it sets.
  const usage = card(page, "Add an outcome for usage alerts");
  await expect(usage.getByText("Usage threshold rules")).toBeVisible();
  await expect(usage.getByText("empty", { exact: true })).toHaveCount(0);
});

test("a decision is confirmed in place and listed as recently decided", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/review");
  const summary = "Add an outcome for usage alerts";

  await card(page, summary).getByRole("button", { name: "Reject" }).click();

  const confirmation = page.getByRole("status");
  await expect(confirmation).toContainText(`Rejected: ${summary}.`);
  await expect(confirmation).toContainText("Nothing on the roadmap changed.");
  await expect(card(page, summary)).toHaveCount(0);
  await expect(waiting(page)).toContainText(
    "4 proposals are waiting for a decision",
  );
  await expect(
    page
      .getByRole("region", { name: "Recently decided" })
      .getByRole("listitem")
      .first(),
  ).toContainText(`Rejected: ${summary}`);
});

test("a double click decides one proposal, not two", async ({ page }) => {
  await page.goto("/p/acme-analytics/review");
  await expect(waiting(page)).toContainText("4 proposals are waiting");

  await card(page, "Excel export is finished")
    .getByRole("button", { name: "Reject" })
    .dblclick();

  await expect(page.getByRole("status")).toContainText(
    "Rejected: Excel export is finished.",
  );
  await expect(waiting(page)).toContainText(
    "3 proposals are waiting for a decision",
  );
  await page.reload();
  await expect(waiting(page)).toContainText(
    "3 proposals are waiting for a decision",
  );
});

test("a link to one proposal scrolls to it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/p/acme-analytics/review");
  const summary = "Link the flaky CSV test fix to CSV export";
  const id = await card(page, summary).getAttribute("id");

  // A fresh load, as from another page; on the same page the browser would scroll by itself.
  await page.goto("about:blank");
  await page.goto(`/p/acme-analytics/review#${id}`);

  await expect(card(page, summary)).toBeInViewport();
});
