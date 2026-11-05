/** Smoke tests: the landing page explains the product and leads into the demo; unknown URLs, metadata files and headers. */
import { expect, test } from "@playwright/test";

test("Open demo goes straight to the Acme Analytics product view", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Open demo" }).click();

  await expect(page).toHaveURL("/p/acme-analytics");
  await expect(
    page.getByRole("heading", { name: "Product roadmap" }),
  ).toBeVisible();
  await expect(page.getByText("Acme Analytics", { exact: true })).toBeVisible();
});

test("the landing page previews the demo live and links to the review queue and source", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByText("No sign-in needed")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View source on GitHub" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/JakobKrzyston/throughline-roadmap",
  );
  const product = page.getByRole("region", { name: "Product view" });
  await expect(
    product.getByText("Customers can export reports to Excel and CSV"),
  ).toBeVisible();
  const technical = page.getByRole("region", { name: "Technical view" });
  await expect(technical.getByText("Background job queue")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Review queue" })
      .getByText("Excel export is finished"),
  ).toBeVisible();

  await page.getByRole("link", { name: "Try approving a proposal" }).click();
  await expect(page).toHaveURL("/p/acme-analytics/review");
  await expect(
    page.getByRole("heading", { name: "Review queue" }),
  ).toBeVisible();
});

test("an unknown URL gets a branded 404 with a way back", async ({ page }) => {
  for (const path of ["/nope", "/p/acme-analytics/nope"]) {
    const response = await page.goto(path);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "We could not find that page" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open the demo" }),
    ).toHaveAttribute("href", "/p/acme-analytics");
  }

  await page.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page).toHaveURL("/");
});

test("robots, sitemap, share image and security headers are served", async ({
  request,
}) => {
  const home = await request.get("/");
  expect(home.headers()).toMatchObject({
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
  });
  expect(home.headers()["permissions-policy"]).toContain("camera=()");
  expect(await home.text()).toContain('property="og:image"');

  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap:");
  expect(await (await request.get("/sitemap.xml")).text()).toContain(
    "/p/acme-analytics/tech",
  );
  const image = await request.get("/opengraph-image");
  expect(image.headers()["content-type"]).toBe("image/png");
});
