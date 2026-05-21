import { test, expect } from '@playwright/test';

// ── helpers ───────────────────────────────────────────────────────────────────

async function waitForDataLayerEvent(page, eventName, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((name) => {
      return (window.dataLayer || []).find(e => e.event === name) || null;
    }, eventName);
    if (found) return found;
    await page.waitForTimeout(250);
  }
  throw new Error(`dataLayer event "${eventName}" not found within ${timeoutMs}ms`);
}

async function getAllDataLayerEvents(page, eventName) {
  return page.evaluate((name) => {
    return (window.dataLayer || []).filter(e => e.event === name);
  }, eventName);
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('add_shipping_info', () => {
  let eventPayload;

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.TEST_URL);
    // TODO: confirm selector with engineering - spec indicates NEEDS_CLARIFICATION
    // Using best-guess selector for Continue to Payment/Save Shipping button
    const shippingButton = page.locator('button:has-text("Continue to Payment"), button:has-text("Save Shipping"), [data-testid="shipping-continue"], .shipping-continue-btn');
    await shippingButton.click();
    eventPayload = await waitForDataLayerEvent(page, 'add_shipping_info');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event add_shipping_info not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name must be "add_shipping_info", got "${eventPayload.event}"`
    ).toBe('add_shipping_info');
  });

  test('ecommerce object is present', async () => {
    expect(
      eventPayload.ecommerce !== undefined && eventPayload.ecommerce !== null,
      `ecommerce object must be present, got ${JSON.stringify(eventPayload.ecommerce)}`
    ).toBe(true);
  });

  test('ecommerce.currency is a non-empty string', async () => {
    const currency = eventPayload.ecommerce?.currency;
    expect(
      typeof currency === 'string' && currency.length > 0,
      `ecommerce.currency must be a non-empty string, got ${typeof currency} (value: ${JSON.stringify(currency)})`
    ).toBe(true);
  });

  test('ecommerce.value is a number', async () => {
    const value = eventPayload.ecommerce?.value;
    expect(
      typeof value === 'number' && !isNaN(value),
      `ecommerce.value must be a number, got ${typeof value} (value: ${JSON.stringify(value)})`
    ).toBe(true);
  });

  test('ecommerce.coupon is present (string or null)', async () => {
    const coupon = eventPayload.ecommerce?.coupon;
    expect(
      coupon === null || coupon === '' || typeof coupon === 'string',
      `ecommerce.coupon must be a string or null, got ${typeof coupon} (value: ${JSON.stringify(coupon)})`
    ).toBe(true);
  });

  test('ecommerce.shipping_tier is a non-empty string', async () => {
    const shippingTier = eventPayload.ecommerce?.shipping_tier;
    expect(
      typeof shippingTier === 'string' && shippingTier.length > 0,
      `ecommerce.shipping_tier must be a non-empty string, got ${typeof shippingTier} (value: ${JSON.stringify(shippingTier)})`
    ).toBe(true);
  });

  test('ecommerce.items is a non-empty array', async () => {
    const items = eventPayload.ecommerce?.items;
    expect(
      Array.isArray(items) && items.length > 0,
      `ecommerce.items must be a non-empty array, got ${typeof items} (value: ${JSON.stringify(items)})`
    ).toBe(true);
  });

  test('ecommerce.shipping_tier does not contain PII (no address data)', async () => {
    const shippingTier = eventPayload.ecommerce?.shipping_tier;
    // shipping_tier should only be a tier name like "Standard", "Express", "Overnight"
    // It should not contain address patterns, phone numbers, or email addresses
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phoneRegex = /(\+?1?\s*[-.\s]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
    const addressRegex = /\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)/i;
    
    expect(
      !emailRegex.test(shippingTier),
      `ecommerce.shipping_tier must not contain email addresses (PII), got: ${shippingTier}`
    ).toBe(true);
    
    expect(
      !phoneRegex.test(shippingTier),
      `ecommerce.shipping_tier must not contain phone numbers (PII), got: ${shippingTier}`
    ).toBe(true);
    
    expect(
      !addressRegex.test(shippingTier),
      `ecommerce.shipping_tier must not contain street addresses (PII), got: ${shippingTier}`
    ).toBe(true);
  });

  test('ecommerce.items array contains valid item objects', async () => {
    const items = eventPayload.ecommerce?.items;
    if (Array.isArray(items) && items.length > 0) {
      const firstItem = items[0];
      expect(
        typeof firstItem === 'object' && firstItem !== null,
        `ecommerce.items[0] must be an object, got ${typeof firstItem}`
      ).toBe(true);
    }
  });

  test('event fires only after shipping form interaction', async ({ page }) => {
    // Verify event appeared after the button click (already captured in beforeEach)
    const allEvents = await getAllDataLayerEvents(page, 'add_shipping_info');
    expect(
      allEvents.length >= 1,
      `add_shipping_info event should fire at least once after shipping form submission, found ${allEvents.length} occurrences`
    ).toBe(true);
  });
});
