import { expect, test } from "playwright/test";

test("Agent Lab completes through the real MCP gateway with visible progress", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("PCM Decision Twin", { exact: false }).first()).toBeVisible();

  await page.getByText("Agent Lab", { exact: true }).first().click();
  await expect(page.getByText("Agent Lab", { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/GATEWAY READY|REAL MCP/)).toBeVisible();

  await page.getByRole("button", { name: /Run workflow/i }).click();
  await expect(page.getByText("REAL MCP", { exact: true })).toBeVisible();
  await expect(page.getByText("Workflow completed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Analysis workflow trace" })).toBeVisible();
  await expect(page.getByText(/Real MCP trace · 5 calls · [a-f0-9]{12}/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision package preview" })).toBeVisible();

  await page.screenshot({
    path: "test-results/agent-lab-real-mcp.png",
    fullPage: true,
  });
});

test("Agent Lab remains usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByText("Agent Lab", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /PCM Decision-Twin Workflow Lab/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run workflow/i })).toBeVisible();

  await page.getByRole("button", { name: /Run workflow/i }).click();
  await expect(page.getByText("Workflow completed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("REAL MCP", { exact: true })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "test-results/agent-lab-real-mcp-mobile.png",
    fullPage: true,
  });
});
