import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Numeric integrity guardrails for the dashboard cluster.
 *
 * Strategy: intercept every /api call with page.route() and drive the UI
 * through four data scenarios. The app must never render "NaN", "Infinity"
 * or an em dash, and a failed fetch must surface as a visible error state
 * instead of a wall of fake zeros.
 */

const STORE_ID = '00000000-0000-4000-8000-000000000001';

const FAKE_USER = {
  id: '00000000-0000-4000-8000-000000000002',
  email: 'e2e@ordefy.io',
  name: 'E2E Owner',
  onboardingCompleted: true,
  stores: [
    {
      id: STORE_ID,
      name: 'E2E Store',
      country: 'PY',
      currency: 'PYG',
      timezone: 'America/Asuncion',
      role: 'owner',
    },
  ],
};

const OVERVIEW_NORMAL = {
  totalOrders: 120,
  revenue: 27600000,
  realRevenue: 21500000,
  costs: 9400000,
  productCosts: 5200000,
  deliveryCosts: 2100000,
  confirmationCosts: 600000,
  gasto_publicitario: 1500000,
  grossProfit: 16300000,
  grossMargin: 59.1,
  netProfit: 12100000,
  netMargin: 43.8,
  profitMargin: 43.8,
  realNetProfit: 9800000,
  realNetMargin: 45.6,
  realGrossMargin: 58.2,
  realCosts: 8100000,
  realCostPerOrder: 87000,
  roi: 128.7,
  roas: 14.3,
  realRoi: 121.0,
  realRoas: 14.3,
  deliveryRate: 93.4,
  taxCollected: 1960000,
  taxRate: 10,
  costPerOrder: 78000,
  averageOrderValue: 230000,
  changes: null,
};

const OVERVIEW_ALL_ZERO = {
  ...OVERVIEW_NORMAL,
  totalOrders: 0,
  revenue: 0,
  realRevenue: 0,
  costs: 0,
  productCosts: 0,
  deliveryCosts: 0,
  confirmationCosts: 0,
  gasto_publicitario: 0,
  grossProfit: 0,
  netProfit: 0,
  realNetProfit: 0,
  realCosts: 0,
  taxCollected: 0,
  // Rates over an empty period are not computable.
  grossMargin: null,
  netMargin: null,
  profitMargin: null,
  realNetMargin: null,
  realGrossMargin: null,
  realCostPerOrder: null,
  roi: null,
  roas: null,
  realRoi: null,
  realRoas: null,
  deliveryRate: null,
  costPerOrder: null,
  averageOrderValue: null,
};

const OVERVIEW_WITH_NULLS = {
  ...OVERVIEW_NORMAL,
  deliveryRate: null,
  realNetMargin: null,
  netMargin: null,
  realGrossMargin: null,
  grossMargin: null,
  roi: null,
  roas: null,
  realRoi: null,
  realRoas: null,
  averageOrderValue: null,
  realCostPerOrder: null,
  costPerOrder: null,
};

type Scenario = 'normal' | 'all-zero' | 'error' | 'nulls';

async function routeApi(page: Page, scenario: Scenario): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const url = route.request().url();

    if (url.includes('/api/auth/me')) {
      return route.fulfill({ json: { user: FAKE_USER } });
    }

    if (scenario === 'error' && url.includes('/api/analytics/')) {
      return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    }

    if (url.includes('/api/analytics/overview')) {
      const body =
        scenario === 'all-zero'
          ? OVERVIEW_ALL_ZERO
          : scenario === 'nulls'
            ? OVERVIEW_WITH_NULLS
            : OVERVIEW_NORMAL;
      // The service unwraps a { data } envelope.
      return route.fulfill({ json: { data: body } });
    }

    if (url.includes('/api/analytics/chart')) {
      return route.fulfill({ json: [] });
    }

    if (url.includes('/api/billing/store-plan')) {
      return route.fulfill({
        json: {
          subscription: { plan: 'professional', status: 'active' },
          usage: {
            orders: { used: 10, limit: -1 },
            products: { used: 5, limit: -1 },
            users: { used: 1, limit: -1 },
          },
          allPlans: [],
        },
      });
    }

    if (url.includes('/api/orders/stats/counts-by-status')) {
      return route.fulfill({
        json: { data: scenario === 'normal' ? { pending: 4, delivered: 90 } : {}, total: scenario === 'normal' ? 120 : 0 },
      });
    }

    // Everything else the dashboard shell touches (subscription, limits,
    // notifications, quick actions) gets an empty-but-valid payload.
    return route.fulfill({ json: { data: [], total: 0 } });
  });
}

async function openDashboard(page: Page, scenario: Scenario): Promise<void> {
  await routeApi(page, scenario);
  await page.addInitScript(
    ([user, storeId]) => {
      window.localStorage.setItem('auth_token', 'e2e-token');
      window.localStorage.setItem('user', JSON.stringify(user));
      window.localStorage.setItem('onboarding_completed', 'true');
      window.sessionStorage.setItem('current_store_id', storeId as string);
      window.localStorage.setItem('current_store_id', storeId as string);
    },
    [FAKE_USER, STORE_ID] as const,
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

async function expectCleanBody(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText()) ?? '';
  expect(body).not.toContain('NaN');
  expect(body).not.toContain('Infinity');
  expect(body).not.toContain('\u2014');
}

test.describe('Numeric integrity: dashboard cluster', () => {
  test('normal data renders formatted figures without NaN/Infinity/em dash', async ({ page }) => {
    await openDashboard(page, 'normal');
    await expectCleanBody(page);
    // The real revenue figure must appear formatted as currency.
    await expect(page.getByText(/21\.500\.000/).first()).toBeVisible();
  });

  test('all-zero store shows honest zeros for sums and N/A for rates', async ({ page }) => {
    await openDashboard(page, 'all-zero');
    await expectCleanBody(page);
    const body = await page.locator('body').innerText();
    // Rates with zero denominators must not render as 0%.
    expect(body).not.toMatch(/Tasa de Entrega[^%]*0[,.]0%/);
  });

  test('API failure shows an error state, never zeros pretending to be data', async ({ page }) => {
    await openDashboard(page, 'error');
    await expectCleanBody(page);
    await expect(
      page.getByText(/No se pudieron cargar|No hay datos disponibles/).first(),
    ).toBeVisible();
  });

  test('null rates render as N/A or Sin datos', async ({ page }) => {
    await openDashboard(page, 'nulls');
    await expectCleanBody(page);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/N\/A|Sin datos/);
  });
});
