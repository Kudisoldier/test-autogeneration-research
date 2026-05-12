import { test, expect } from '@playwright/test';

const validForm = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  rating: '5',
  message: 'Great product experience!',
};

async function fillValidForm(page) {
  await page.getByTestId('input-name').fill(validForm.name);
  await page.getByTestId('input-email').fill(validForm.email);
  await page.getByTestId('select-rating').selectOption(validForm.rating);
  await page.getByTestId('textarea-message').fill(validForm.message);
}

test.describe('Feedback Form E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('feedback-form')).toBeVisible();
  });

  // plan-case: submit-feedback-happy-path
  test('User submits valid feedback successfully', async ({ page }) => {
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Feedback submitted successfully!',
          feedback: {
            id: 'e2e-1',
            name: validForm.name,
            email: validForm.email,
            rating: Number(validForm.rating),
            message: validForm.message,
            timestamp: new Date().toISOString(),
          },
        }),
      });
    });

    await fillValidForm(page);
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('submit-status-success')).toBeVisible();
    await expect(page.getByTestId('submit-status-success')).toContainText(/submitted/i);
  });

  // plan-case: validation-empty-required-fields
  test('Validation errors shown for empty required fields', async ({ page }) => {
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('error-name')).toBeVisible();
    await expect(page.getByTestId('error-email')).toBeVisible();
    await expect(page.getByTestId('error-rating')).toBeVisible();
    await expect(page.getByTestId('error-message')).toBeVisible();
  });

  // plan-case: validation-invalid-email
  test('Invalid email format shows validation error', async ({ page }) => {
    const email = page.getByTestId('input-email');
    await email.fill('not-an-email');
    await email.blur();
    await expect(page.getByTestId('error-email')).toBeVisible();
    await expect(page.getByTestId('error-email')).toContainText(/valid email/i);
  });

  // plan-case: submit-button-disabled-during-submit
  test('Submit button is disabled and shows loading state during submission', async ({ page }) => {
    let releasePost;
    const postBlocked = new Promise((resolve) => {
      releasePost = resolve;
    });

    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await postBlocked;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Feedback submitted successfully!',
          feedback: {
            id: 'e2e-slow',
            name: validForm.name,
            email: validForm.email,
            rating: Number(validForm.rating),
            message: validForm.message,
            timestamp: new Date().toISOString(),
          },
        }),
      });
    });

    await fillValidForm(page);
    const submit = page.getByTestId('submit-button');
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText(/Submitting/i);
    releasePost();
    await expect(page.getByTestId('submit-status-success')).toBeVisible({ timeout: 15_000 });
    await expect(submit).toBeEnabled();
  });

  // plan-case: error-handling-submission-failure
  test('Error message displayed when submission fails', async ({ page }) => {
    await page.route('**/api/feedback', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server exploded' }),
      });
    });

    await fillValidForm(page);
    await page.getByTestId('submit-button').click();
    await expect(page.getByTestId('submit-status-error')).toBeVisible();
    await expect(page.getByTestId('submit-status-error')).toContainText(/Server exploded|submit/i);
  });

  // plan-case: error-clears-on-edit
  test('Validation errors clear when user starts editing field', async ({ page }) => {
    const email = page.getByTestId('input-email');
    await email.fill('bad');
    await email.blur();
    await expect(page.getByTestId('error-email')).toBeVisible();
    await email.fill('fixed@example.com');
    await expect(page.getByTestId('error-email')).not.toBeAttached();
  });

  // plan-case: blur-validation-triggers
  test('Field validation triggers on blur event', async ({ page }) => {
    const email = page.getByTestId('input-email');
    await email.fill('x');
    await email.blur();
    await expect(page.getByTestId('error-email')).toBeVisible();
    await expect(page.getByTestId('error-email')).toContainText(/valid email/i);
  });
});
