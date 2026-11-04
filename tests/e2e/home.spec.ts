/** Smoke test: "Open demo" on the home page goes straight to the demo with no sign-in. */
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
  await expect(page.getByText("Acme Analytics")).toBeVisible();
});
