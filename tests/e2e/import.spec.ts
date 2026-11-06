/** Smoke test: a roadmap imports from a sample export, an uploaded file or the sample Linear workspace, and a bad file is explained. */
import { expect, test } from "@playwright/test";

// An empty project made by seed-import-project.ts, so these imports leave the demo's queue alone.
const IMPORT_PAGE = "/p/import-e2e/import";

test("a sample export becomes a proposal in the review queue", async ({
  page,
}) => {
  await page.goto(IMPORT_PAGE);

  await page.getByRole("button", { name: "Jira CSV" }).click();
  await expect(page.getByLabel("Roadmap", { exact: true })).toHaveValue(
    /^Summary,Issue key/,
  );
  await page.getByRole("button", { name: "Generate proposal" }).click();

  const summary = "Import 3 outcomes and 8 requirements from a pasted roadmap";
  await expect(page.getByText(summary)).toBeVisible();
  // The link names this proposal's card, which stays unique when a retry imports the sample again.
  const link = page.getByRole("link", { name: "Review the proposal" });
  const cardId = (await link.getAttribute("href"))!.split("#")[1];
  await link.click();
  const card = page.locator(`article#${cardId}`);
  await expect(
    card.getByText("Customers get their dashboards by email on a schedule"),
  ).toBeVisible();
});

test("an uploaded file becomes a proposal", async ({ page }) => {
  await page.goto(IMPORT_PAGE);

  await page.getByLabel("Or upload an export").setInputFiles({
    name: "roadmap.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 2027\n\n- Mobile app\n- Anomaly alerts\n"),
  });
  await page.getByRole("button", { name: "Generate proposal" }).click();

  await expect(
    page.getByText(
      "Import 2 outcomes and 5 requirements from an uploaded file",
    ),
  ).toBeVisible();
});

test("an unsupported file gets a clear error and saves nothing", async ({
  page,
}) => {
  await page.goto(IMPORT_PAGE);

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

test("a Linear team from the sample workspace becomes a proposal", async ({
  page,
}) => {
  await page.goto(IMPORT_PAGE);

  await expect(page.getByText("reads a sample Linear workspace")).toBeVisible();
  // Teams load only on request, so the page itself never waits on Linear.
  await expect(page.getByLabel("Linear team")).toHaveCount(0);
  await page.getByRole("button", { name: "Choose a Linear team" }).click();
  await page.getByLabel("Linear team").selectOption({ label: "Product" });
  await page.getByRole("button", { name: "Import from Linear" }).click();

  const summary =
    "Import 3 outcomes and 6 requirements from the Linear team Product";
  await expect(page.getByText(summary)).toBeVisible();
  const link = page.getByRole("link", { name: "Review the proposal" });
  const cardId = (await link.getAttribute("href"))!.split("#")[1];
  await link.click();
  const card = page.locator(`article#${cardId}`);
  await expect(card.getByText("Dashboards on the go")).toBeVisible();
  await expect(card.getByText("Dashboard comments")).toHaveCount(0);
});

test("a product and a technical roadmap import together, and every item is placed before approving", async ({
  page,
}) => {
  await page.goto(IMPORT_PAGE);

  await page.getByLabel("Product and technical roadmap").check();
  await page
    .getByRole("button", { name: "Acme product and Jira CSVs" })
    .click();
  await expect(page.getByLabel("Product roadmap", { exact: true })).toHaveValue(
    /^Product item,Status/,
  );
  await expect(
    page.getByLabel("Technical roadmap", { exact: true }),
  ).toHaveValue(/^Issue key,Summary/);
  await page.getByRole("button", { name: "Generate proposal" }).click();

  const summary =
    "Import 3 outcomes and 6 requirements from a product and a technical roadmap, with 2 items to place";
  await expect(page.getByText(summary)).toBeVisible();
  const link = page.getByRole("link", { name: "Review the proposal" });
  const cardId = (await link.getAttribute("href"))!.split("#")[1];
  await link.click();
  const card = page.locator(`article#${cardId}`);

  await expect(card.getByText("Low-confidence link")).toBeVisible();
  await expect(
    card.getByText("Usage page for account owners (already shipped)"),
  ).toBeVisible();
  const approve = card.getByRole("button", { name: "Approve" });
  await card
    .getByLabel("Where Tune connection pool for sync workers goes")
    .selectOption({ label: "Snowflake connector" });
  await expect(approve).toBeDisabled();
  await card
    .getByLabel("Where Upgrade Postgres goes")
    .selectOption({ label: "Leave it out" });
  await approve.click();

  await expect(page.getByRole("status")).toContainText(`Approved: ${summary}.`);
});
