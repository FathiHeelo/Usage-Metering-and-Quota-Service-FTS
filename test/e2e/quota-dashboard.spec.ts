import { expect, test, type Page } from "@playwright/test";

async function openPage(
  page: Page,
  name: string,
  heading: string | RegExp,
): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

async function createPlan(
  page: Page,
  input: {
    name: string;
    scope: "ACCOUNT" | "USER";
    monthlyAllowance: number;
    maxUnitsPerRequest: number;
  },
): Promise<void> {
  await page.getByRole("button", { name: "New custom plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a custom plan" });
  await dialog.getByLabel("Plan name").fill(input.name);
  await dialog.getByLabel("Plan scope").selectOption(input.scope);
  await dialog.getByLabel("Monthly allowance").fill(String(input.monthlyAllowance));
  await dialog
    .getByLabel("Maximum units per request")
    .fill(String(input.maxUnitsPerRequest));
  await dialog.getByRole("button", { name: "Create plan" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: input.name })).toBeVisible();
}

async function submitUsage(
  page: Page,
  input: { userId: string; units: number; requestId: string },
  expected: "ACCEPTED" | "REJECTED",
): Promise<void> {
  await page.getByLabel("User identifier").fill(input.userId);
  await page.getByLabel("Number of units").fill(String(input.units));
  await page.getByLabel("Unique request ID").fill(input.requestId);
  await page.getByRole("button", { name: "Consume units" }).click();
  await expect(page.locator(".decision-card").getByText(expected, { exact: true })).toBeVisible();
}

test("dashboard completes a real quota and idempotency workflow", async ({ page }) => {
  const suffix = Date.now();
  const accountName = `E2E Account ${suffix}`;
  const firstUser = `e2e_first_${suffix}`;
  const secondUser = `e2e_second_${suffix}`;
  const accountPlan = `E2E Account Plan ${suffix}`;
  const tightPlan = `E2E Tight User ${suffix}`;
  const widePlan = `E2E Wide User ${suffix}`;

  await page.goto("/");
  await page.getByLabel("Account name").fill(accountName);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("dialog", { name: "Save your API key" })).toBeVisible();
  await page.getByRole("button", { name: "I saved the key" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(accountName) })).toBeVisible();

  await openPage(page, "Users", "Users and individual quotas");
  const createUserForm = page.getByRole("form", { name: "Create user" });
  await createUserForm.getByLabel("External user identifier").fill(firstUser);
  await createUserForm.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText(firstUser, { exact: true }).first()).toBeVisible();
  await createUserForm.getByLabel("External user identifier").fill(secondUser);
  await createUserForm.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText(secondUser, { exact: true }).first()).toBeVisible();

  await openPage(page, "Plans", "Limits for every level");
  await createPlan(page, {
    name: accountPlan,
    scope: "ACCOUNT",
    monthlyAllowance: 25,
    maxUnitsPerRequest: 20,
  });
  await createPlan(page, {
    name: tightPlan,
    scope: "USER",
    monthlyAllowance: 15,
    maxUnitsPerRequest: 10,
  });
  await createPlan(page, {
    name: widePlan,
    scope: "USER",
    monthlyAllowance: 100,
    maxUnitsPerRequest: 20,
  });

  await page
    .getByLabel("Available ACCOUNT plan")
    .selectOption({ label: `${accountPlan} · 25/month` });
  await page.getByRole("button", { name: "Apply account plan" }).click();
  await expect(page.getByRole("status")).toContainText(`Account plan changed to ${accountPlan}`);

  await page.getByLabel("User identifier").fill(firstUser);
  await page.getByLabel("USER plan").selectOption({ label: tightPlan });
  await page.getByRole("button", { name: "Assign user plan" }).click();
  await expect(page.getByRole("status")).toContainText(`${firstUser} now uses ${tightPlan}`);
  await page.getByLabel("User identifier").fill(secondUser);
  await page.getByLabel("USER plan").selectOption({ label: widePlan });
  await page.getByRole("button", { name: "Assign user plan" }).click();
  await expect(page.getByRole("status")).toContainText(`${secondUser} now uses ${widePlan}`);

  await openPage(page, "Usage playground", "Usage playground");
  await submitUsage(page, { userId: firstUser, units: 10, requestId: `accepted_${suffix}` }, "ACCEPTED");
  await submitUsage(page, { userId: firstUser, units: 6, requestId: `user_rejected_${suffix}` }, "REJECTED");
  await expect(page.locator(".decision-card")).toContainText("user plan's monthly allowance");
  await submitUsage(page, { userId: secondUser, units: 20, requestId: `account_rejected_${suffix}` }, "REJECTED");
  await expect(page.locator(".decision-card")).toContainText("account plan's monthly allowance");

  await openPage(page, "Plans", "Limits for every level");
  const accountPlanCard = page.locator("article.plan-card").filter({ hasText: accountPlan });
  await accountPlanCard.getByRole("button", { name: "Edit custom plan" }).click();
  const editDialog = page.getByRole("dialog", { name: `Edit ${accountPlan}` });
  await editDialog.getByLabel("Monthly allowance").fill("40");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(editDialog).toBeHidden();

  await openPage(page, "Usage playground", "Usage playground");
  const acceptedAfterUpdate = `accepted_after_update_${suffix}`;
  await submitUsage(page, { userId: secondUser, units: 20, requestId: acceptedAfterUpdate }, "ACCEPTED");
  await expect(page.locator(".decision-card")).toContainText("30 used");
  await page.getByRole("button", { name: "Retry exact request" }).click();
  await expect(page.locator(".decision-card")).toContainText("30 used");

  await openPage(page, "Request history", "Usage request history");
  await expect(page.getByRole("heading", { name: "4 requests" })).toBeVisible();
  for (const requestId of [
    `accepted_${suffix}`,
    `user_rejected_${suffix}`,
    `account_rejected_${suffix}`,
    acceptedAfterUpdate,
  ]) {
    await expect(page.getByText(requestId, { exact: true })).toBeVisible();
  }
});
