/** Smoke test: the project top bar, page titles, mobile navigation and the colour theme. */
import { expect, test } from "@playwright/test";

test("each page has its own title and the top bar leads home", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/review");
  await expect(page).toHaveTitle("Review queue · Acme Analytics · Throughline");
  await expect(
    page
      .getByRole("navigation", { name: "Acme Analytics pages" })
      .getByRole("link", { name: /Review queue \d+ waiting/ }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Throughline", exact: true }).click();
  await expect(page).toHaveURL("/");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the tabs stay on one line with full-size touch targets", async ({
    page,
  }) => {
    await page.goto("/p/acme-analytics/settings");
    const nav = page.getByRole("navigation", { name: "Acme Analytics pages" });
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(7);

    const boxes = await links.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect()),
    );
    expect(new Set(boxes.map((box) => box.top)).size).toBe(1);
    for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
    // The current tab is scrolled into view, and only the tab row scrolls, not the page.
    await expect(nav.getByRole("link", { name: "Settings" })).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBe(0);
  });
});

test.describe("with the system in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("pages are dark", async ({ page }) => {
    await page.goto("/p/acme-analytics");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    // Paint the background colour onto a canvas to read it as RGB, whatever colour space CSS uses.
    const [red, green, blue] = await page.evaluate(() => {
      const canvas = document.createElement("canvas").getContext("2d")!;
      canvas.fillStyle = getComputedStyle(document.body).backgroundColor;
      canvas.fillRect(0, 0, 1, 1);
      return [...canvas.getImageData(0, 0, 1, 1).data];
    });
    expect(Math.max(red, green, blue)).toBeLessThan(40);
  });
});

test("the theme control overrides the system and remembers the choice", async ({
  page,
}) => {
  await page.goto("/p/acme-analytics/plan");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(
    page.getByRole("button", { name: "Dark theme" }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Use the system theme" }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});
