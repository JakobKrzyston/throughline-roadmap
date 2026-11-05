/** Smoke test: the product, technical, plan and feedback pages load for the Acme Analytics demo project. */
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
  // Who works on what and which team owns it are technical detail.
  await expect(page.locator("main")).not.toContainText("maya-chen");
  await expect(page.locator("main")).not.toContainText("Platform");

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

test("technical view filters requirements by person and sums them up by team", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/tech");
  const exportOutcome = page
    .getByRole("listitem")
    .filter({ hasText: "Customers can export reports to Excel and CSV" })
    .first();
  await expect(
    exportOutcome.getByText("Data: 2 of 3 done · Web: 0 of 1 done"),
  ).toBeVisible();

  await page.getByLabel("Person").selectOption("leo-martins");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/person=leo-martins/);
  await expect(
    page.getByText("Export button in report toolbar", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Background job queue", { exact: true }),
  ).toBeHidden();

  await page.getByRole("link", { name: "Show everything" }).click();
  await expect(
    page.getByText("Background job queue", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Person")).toHaveValue("");
});

test("plan page reorders outcomes and moves targets into the change feed", async ({
  page,
}) => {
  // Tall enough that the drag below needs no scrolling, which would move the drop point.
  await page.setViewportSize({ width: 1280, height: 2400 });
  await page.goto("/p/acme-analytics/plan");

  await expect(
    page.getByText(
      "TL-10 Retry and bounce handling is due Q2 2027, after this outcome's target.",
    ),
  ).toBeVisible();

  const share = "Customers can share a dashboard with a link";
  await expect(page.getByRole("article").nth(4)).toHaveAccessibleName(share);
  const up = page.getByRole("button", { name: `Move “${share}” up` });
  await up.click();
  await expect(page.getByRole("article").nth(3)).toHaveAccessibleName(share);
  // Focus follows the moved outcome, and the new place is announced.
  await expect(up).toBeFocused();
  await expect(
    page.getByText(`“${share}” is now number 4 of 5.`),
  ).toBeVisible();
  // Dragging works as well as the buttons.
  await page
    .getByRole("heading", { name: share })
    .dragTo(page.getByRole("article").first().getByRole("heading"));
  await expect(page.getByRole("article").first()).toHaveAccessibleName(share);

  // A requirement saves its target, kind of work and team together, and keeps them when refused.
  await page.getByText("Requirements (").nth(1).click();
  const csv = "TL-3 CSV export";
  const kind = page.getByRole("combobox", { name: `Kind of work for ${csv}` });
  const target = page.getByRole("combobox", { name: `Target for ${csv}` });
  const saveRow = page.getByRole("button", { name: `Save ${csv}` });
  await kind.selectOption("research");
  await target.fill("next spring");
  await saveRow.click();
  await expect(page.getByText("Use a quarter like 2027-Q1")).toBeVisible();
  await expect(kind).toHaveValue("research");
  await expect(target).toHaveValue("next spring");
  await target.fill("2027-Q2");
  await saveRow.click();
  await expect(saveRow).toBeDisabled();
  await expect(kind).toHaveValue("research");

  const dashboards = "Dashboards load in under two seconds";
  await page
    .getByRole("combobox", { name: `Target for ${dashboards}` })
    .fill("2027-Q3");
  const save = page.getByRole("button", {
    name: `Save target for ${dashboards}`,
  });
  await save.click();
  // Disabled once the saved target matches the box again.
  await expect(save).toHaveText("Save");
  await expect(save).toBeDisabled();

  await page.goto("/p/acme-analytics");
  const feed = page.getByRole("region", { name: "What changed this week" });
  await expect(feed.getByText("Moved from Q1 2027 to Q3 2027.")).toBeVisible();
  await expect(
    feed.getByText("Now comes before “Dashboards load in under two seconds”."),
  ).toBeVisible();
});

test("feedback page shows what customers ask for and links a gap to an outcome", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/feedback");

  const pull = page.getByRole("region", { name: "Asked for, by outcome" });
  await expect(
    pull.getByText("Customers can export reports to Excel and CSV"),
  ).toBeVisible();
  await expect(pull.getByText("2 pieces of feedback").first()).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Waiting for review" })
      .getByText("Can I send a dashboard to a client who has no account?"),
  ).toBeVisible();
  const gaps = page.getByRole("region", { name: "Not on the roadmap" });
  await expect(gaps.getByRole("heading", { name: /Dark mode/ })).toBeVisible();

  const phone = "Let us check dashboards on a phone";
  await gaps
    .getByRole("combobox", { name: `Outcome for “${phone}”` })
    .selectOption({ label: "Dashboards load in under two seconds" });
  await gaps.getByRole("button", { name: `Link “${phone}”` }).click();
  await expect(gaps.getByText(phone)).toHaveCount(0);
  await pull.getByText("Dashboards load in under two seconds").click();
  await expect(pull.getByRole("link", { name: phone })).toBeVisible();
});

test("an unknown project gets a plain-language, unindexed page", async ({
  page,
}) => {
  for (const path of ["/p/no-such-project", "/p/no-such-project/tech"]) {
    await page.goto(path);

    // The status stays 200 because the lookup runs after the shell streams; noindex keeps it out of search.
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      "content",
      "noindex",
    );
    await expect(
      page.getByRole("heading", { name: "We could not find that project" }),
    ).toBeVisible();
  }
});

test("every project page links to the others", async ({ page }) => {
  await page.goto("/p/acme-analytics/review");
  const nav = page.getByRole("navigation", { name: "Acme Analytics pages" });

  for (const [link, heading] of [
    ["Import", "Import a roadmap"],
    ["Settings", "Settings"],
    ["Technical view", "Technical roadmap"],
    ["Plan", "Plan"],
    ["Feedback", "Customer feedback"],
    ["Review queue", "Review queue"],
    ["Product view", "Product roadmap"],
  ]) {
    await nav.getByRole("link", { name: link }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: link })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("settings previews the weekly digest in plain language", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/settings");

  await expect(
    page.getByRole("heading", { name: "Weekly digest" }),
  ).toBeVisible();
  const preview = page.locator("pre");
  await expect(preview).toContainText("Acme Analytics: roadmap update,");
  await expect(preview).toContainText(
    "Customers can export reports to Excel and CSV: Partially available",
  );
  await expect(preview).not.toContainText(TICKET_NUMBER);
  await expect(page.getByLabel("Slack incoming webhook URL")).toBeVisible();
});
