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

test.describe('purchase', () => {
  let eventPayload;

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.TEST_URL);
    eventPayload = await waitForDataLayerEvent(page, 'purchase');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event "purchase" not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name must be "purchase", got "${eventPayload.event}"`
    ).toBe('purchase');
  });

  test('ecommerce object is present', async () => {
    expect(
      eventPayload.ecommerce,
      'ecommerce object must be present in the event payload'
    ).toBeTruthy();
  });

  test('transaction_id is present and is a string', async () => {
    const value = eventPayload.ecommerce?.transaction_id;
    expect(
      value !== undefined && value !== null,
      `transaction_id must be present, got ${value}`
    ).toBe(true);
    expect(
      typeof value === 'string',
      `transaction_id must be a string, got ${typeof value} (value: ${value})`
    ).toBe(true);
    expect(
      value.length > 0,
      `transaction_id must be a non-empty string, got empty string`
    ).toBe(true);
  });

  test('value is present and is a number', async () => {
    const value = eventPayload.ecommerce?.value;
    expect(
      value !== undefined && value !== null,
      `value must be present, got ${value}`
    ).toBe(true);
    expect(
      typeof value === 'number' && !isNaN(value),
      `value must be a number, got ${typeof value} (value: ${value})`
    ).toBe(true);
  });

  test('tax is present and is a number', async () => {
    const value = eventPayload.ecommerce?.tax;
    expect(
      value !== undefined && value !== null,
      `tax must be present, got ${value}`
    ).toBe(true);
    expect(
      typeof value === 'number' && !isNaN(value),
      `tax must be a number, got ${typeof value} (value: ${value})`
    ).toBe(true);
  });

  test('shipping is present and is a number', async () => {
    const value = eventPayload.ecommerce?.shipping;
    expect(
      value !== undefined && value !== null,
      `shipping must be present, got ${value}`
    ).toBe(true);
    expect(
      typeof value === 'number' && !isNaN(value),
      `shipping must be a number, got ${typeof value} (value: ${value})`
    ).toBe(true);
  });

  test('currency is present and is a string', async () => {
    const value = eventPayload.ecommerce?.currency;
    expect(
      value !== undefined && value !== null,
      `currency must be present, got ${value}`
    ).toBe(true);
    expect(
      typeof value === 'string',
      `currency must be a string, got ${typeof value} (value: ${value})`
    ).toBe(true);
    expect(
      value.length > 0,
      `currency must be a non-empty string, got empty string`
    ).toBe(true);
  });

  test('currency is a valid ISO 4217 code (3 uppercase letters)', async () => {
    const value = eventPayload.ecommerce?.currency;
    const iso4217Regex = /^[A-Z]{3}$/;
    expect(
      iso4217Regex.test(value),
      `currency must be a valid ISO 4217 code (3 uppercase letters), got "${value}"`
    ).toBe(true);
  });

  test('coupon is present and is a string (can be empty)', async () => {
    const value = eventPayload.ecommerce?.coupon;
    expect(
      value !== undefined && value !== null,
      `coupon must be present, got ${value}`
    ).toBe(true);
    expect(
      typeof value === 'string',
      `coupon must be a string, got ${typeof value} (value: ${value})`
    ).toBe(true);
  });

  test('items is present and is an array', async () => {
    const value = eventPayload.ecommerce?.items;
    expect(
      value !== undefined && value !== null,
      `items must be present, got ${value}`
    ).toBe(true);
    expect(
      Array.isArray(value),
      `items must be an array, got ${typeof value} (value: ${JSON.stringify(value)})`
    ).toBe(true);
  });

  test('items array is not empty', async () => {
    const value = eventPayload.ecommerce?.items;
    expect(
      Array.isArray(value) && value.length > 0,
      `items array must not be empty, got ${JSON.stringify(value)}`
    ).toBe(true);
  });

  test('each item in items array has required properties', async () => {
    const items = eventPayload.ecommerce?.items;
    if (Array.isArray(items)) {
      items.forEach((item, index) => {
        expect(
          item.item_id !== undefined && item.item_id !== null,
          `items[${index}].item_id must be present, got ${item.item_id}`
        ).toBe(true);
        expect(
          item.item_name !== undefined && item.item_name !== null,
          `items[${index}].item_name must be present, got ${item.item_name}`
        ).toBe(true);
      });
    }
  });

  test('no duplicate purchase event on page reload', async ({ page }) => {
    // Reload the page to test deduplication logic
    await page.reload();
    // Wait a bit to allow any duplicate events to fire
    await page.waitForTimeout(2000);
    
    const allPurchaseEvents = await getAllDataLayerEvents(page, 'purchase');
    expect(
      allPurchaseEvents.length,
      `purchase event should fire only once (deduplication), but found ${allPurchaseEvents.length} events`
    ).toBe(1);
  });

  test('value is non-negative', async () => {
    const value = eventPayload.ecommerce?.value;
    expect(
      typeof value === 'number' && value >= 0,
      `value must be a non-negative number, got ${value}`
    ).toBe(true);
  });

  test('tax is non-negative', async () => {
    const value = eventPayload.ecommerce?.tax;
    expect(
      typeof value === 'number' && value >= 0,
      `tax must be a non-negative number, got ${value}`
    ).toBe(true);
  });

  test('shipping is non-negative', async () => {
    const value = eventPayload.ecommerce?.shipping;
    expect(
      typeof value === 'number' && value >= 0,
      `shipping must be a non-negative number, got ${value}`
    ).toBe(true);
  });
});
