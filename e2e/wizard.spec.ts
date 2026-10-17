import { expect, test } from "@playwright/test";

const email = process.env.OWNER_EMAIL!;
const password = process.env.OWNER_PASSWORD!;

test("create VibeJudge from its URL, confirm the profile, and land on a real dashboard", async ({ page }) => {
  const name = `VibeJudge E2E ${Date.now().toString(36)}`;

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // 1-2: name and website
  await page.getByRole("link", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 8: Website")).toBeVisible();
  await page.getByLabel("Website URL").fill("vibejudge.app");
  await page.getByRole("button", { name: "Continue" }).click();

  // 3: live analysis (real crawl, real AI when providers are configured)
  await expect(page.getByText("Step 3 of 8: Analyze")).toBeVisible();
  await expect(page.getByText(/Fetched \//).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/pages crawled/).last()).toBeVisible({ timeout: 180_000 });
  const reloadedProject = page.url();
  await page.reload(); // progress survives a reload
  await expect(page).toHaveURL(reloadedProject);
  await expect(page.getByText("Analysis complete")).toBeVisible({ timeout: 150_000 }); // AI failover can take ~60s
  await page.getByRole("button", { name: /Review profile|Continue/ }).click();

  // 4: profile — AI draft, or the manual path when no provider is configured
  await expect(page.getByText("Step 4 of 8: Profile")).toBeVisible();
  const description = page.getByLabel("What the business does");
  if (!(await description.inputValue()).trim()) await description.fill("AI CV roasts with actionable fixes.");
  await page.getByRole("button", { name: "Confirm and continue" }).click();

  // 5: honest integrations
  await expect(page.getByText("Step 5 of 8: Integrations")).toBeVisible();
  await expect(page.getByText("Not connected").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Connect/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();

  // 6: providers
  await expect(page.getByText("Step 6 of 8: AI providers")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // 7: raising autonomy requires typing the project name
  await expect(page.getByText("Step 7 of 8: Permissions")).toBeVisible();
  await page.getByRole("button", { name: /Creator/ }).click();
  const raise = page.getByRole("button", { name: "Raise to level 2" });
  await expect(raise).toBeDisabled();
  await page.getByLabel("Project name").fill(name);
  await raise.click();
  await expect(page.getByRole("button", { name: /Creator/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue" }).click();

  // 8: dashboard
  await expect(page.getByText("Level 2")).toBeVisible();
  await page.getByRole("button", { name: "Create dashboard" }).click();
  await expect(page.getByText("Basic checks (full audit in Cycle 4)")).toBeVisible();
  await expect(page.getByText("Online · HTTP 200")).toBeVisible();
  await expect(page.getByText("0 of 9 connected")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Online · HTTP 200")).toBeVisible();

  // clean up: archive through the UI
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: `Archive ${name}` }).click();
  await page.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
});
