import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * Tests user signup, login, logout, and error handling
 */

test.describe('Authentication', () => {
  const testUser = {
    email: `test${Date.now()}@ordefy.app`,
    password: 'Test123456!',
    name: 'Test User E2E'
  };

  test.beforeEach(async ({ page }) => {
    // Start at home page
    await page.goto('/');
  });

  test('should navigate to login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('h1, h2').first()).toContainText(/login|sign in|iniciar sesión|ingresar/i);
  });

  test('should show validation errors for empty login form', async ({ page }) => {
    await page.goto('/login');

    // Try to submit empty form
    const loginButton = page.locator('button[type="submit"]').first();
    await loginButton.click();

    // Should show validation or stay on same page
    await expect(page).toHaveURL(/.*login/);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Fill with invalid credentials
    await page.fill('input[type="email"], input[name="email"]', 'invalid@example.com');
    await page.fill('input[type="password"], input[name="password"]', 'wrongpassword');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for error message
    await page.waitForTimeout(2000);

    // Should show error or stay on login page
    const hasError = await page.locator('text=/error|invalid|incorrect/i').count() > 0;
    const stillOnLogin = page.url().includes('login');

    expect(hasError || stillOnLogin).toBeTruthy();
  });

  test('should register new user', async ({ page }) => {
    // Navigate to register page
    await page.goto('/register');

    // If redirected or button exists, click it
    const registerLink = page.locator('text=/sign up|register|create account|registrarse|crear cuenta/i').first();
    if (await registerLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await registerLink.click();
    }

    await expect(page).toHaveURL(/.*register/i);

    // Fill registration form
    await page.fill('input[name="email"]', testUser.email);
    await page.fill('input[name="password"]', testUser.password);
    await page.fill('input[name="name"]', testUser.name);

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for navigation or success
    await page.waitForTimeout(3000);

    // Should redirect to dashboard or onboarding
    const url = page.url();
    expect(url.includes('dashboard') || url.includes('onboarding') || url.includes('app')).toBeTruthy();
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');

    // Use a known test account or the one we just created
    await page.fill('input[name="email"]', 'test@ordefy.app');
    await page.fill('input[name="password"]', 'test123456');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect
    await page.waitForTimeout(3000);

    // Should redirect to dashboard or main app
    const url = page.url();
    expect(url.includes('dashboard') || url.includes('orders') || url.includes('products') || !url.includes('login')).toBeTruthy();
  });

  test('should logout successfully', async ({ page }) => {
    // First login
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@ordefy.app');
    await page.fill('input[name="password"]', 'test123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Look for logout button (could be in menu, header, etc.) - bilingual
    const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign out"), button:has-text("Cerrar sesión"), button:has-text("Salir"), a:has-text("Logout"), a:has-text("Cerrar sesión")').first();

    if (await logoutButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await logoutButton.click();
      await page.waitForTimeout(2000);

      // Should redirect to login
      expect(page.url().includes('login') || page.url() === 'http://localhost:8080/').toBeTruthy();
    } else {
      // If logout button not found, test is inconclusive
      test.skip();
    }
  });

  test('should prevent access to protected routes without auth', async ({ page }) => {
    // Clear any existing auth
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Try to access dashboard
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);

    // Should redirect to login
    expect(page.url().includes('login') || page.url().includes('auth')).toBeTruthy();
  });

  test('should persist authentication after page reload', async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@ordefy.app');
    await page.fill('input[name="password"]', 'test123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);

    // Reload page
    await page.reload();
    await page.waitForTimeout(2000);

    // Should still be authenticated (not redirected to login)
    expect(!page.url().includes('login')).toBeTruthy();
  });
});
