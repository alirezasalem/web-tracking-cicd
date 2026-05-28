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
      `event name should be "purchase", got "${eventPayload.event}"`
    ).toBe('purchase');
  });

  test('ecommerce object is present', async () => {
    expect(
      eventPayload.ecommerce,
      'ecommerce object must be present in the event payload'
    ).toBeDefined();
    expect(
      eventPayload.ecommerce !== null,
      'ecommerce object must not be null'
    ).toBe(true);
  });

  test('transaction_id is present and is a string', async () => {
    const transactionId = eventPayload.ecommerce?.transaction_id;
    expect(
      transactionId !== undefined && transactionId !== null,
      `transaction_id must be present, got ${transactionId}`
    ).toBe(true);
    expect(
      typeof transactionId === 'string',
      `transaction_id must be a string, got ${typeof transactionId} (value: ${transactionId})`
    ).toBe(true);
    expect(
      transactionId.length > 0,
      'transaction_id must be a non-empty string'
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
    const tax = eventPayload.ecommerce?.tax;
    expect(
      tax !== undefined && tax !== null,
      `tax must be present, got ${tax}`
    ).toBe(true);
    expect(
      typeof tax === 'number' && !isNaN(tax),
      `tax must be a number, got ${typeof tax} (value: ${tax})`
    ).toBe(true);
  });

  test('shipping is present and is a number', async () => {
    const shipping = eventPayload.ecommerce?.shipping;
    expect(
      shipping !== undefined && shipping !== null,
      `shipping must be present, got ${shipping}`
    ).toBe(true);
    expect(
      typeof shipping === 'number' && !isNaN(shipping),
      `shipping must be a number, got ${typeof shipping} (value: ${shipping})`
    ).toBe(true);
  });

  test('currency is present and is a string', async () => {
    const currency = eventPayload.ecommerce?.currency;
    expect(
      currency !== undefined && currency !== null,
      `currency must be present, got ${currency}`
    ).toBe(true);
    expect(
      typeof currency === 'string',
      `currency must be a string, got ${typeof currency} (value: ${currency})`
    ).toBe(true);
    expect(
      currency.length > 0,
      'currency must be a non-empty string'
    ).toBe(true);
  });

  test('currency is a valid ISO 4217 code', async () => {
    const currency = eventPayload.ecommerce?.currency;
    const iso4217Pattern = /^[A-Z]{3}$/;
    expect(
      iso4217Pattern.test(currency),
      `currency must be a valid 3-letter ISO 4217 code, got "${currency}"`
    ).toBe(true);
  });

  test('coupon is present and is a string (can be empty)', async () => {
    const coupon = eventPayload.ecommerce?.coupon;
    expect(
      coupon !== undefined,
      `coupon must be present (can be empty string), got undefined`
    ).toBe(true);
    if (coupon !== null) {
      expect(
        typeof coupon === 'string',
        `coupon must be a string if provided, got ${typeof coupon} (value: ${coupon})`
      ).toBe(true);
    }
  });

  test('items is present and is an array', async () => {
    const items = eventPayload.ecommerce?.items;
    expect(
      items !== undefined && items !== null,
      `items must be present, got ${items}`
    ).toBe(true);
    expect(
      Array.isArray(items),
      `items must be an array, got ${typeof items} (value: ${JSON.stringify(items)})`
    ).toBe(true);
  });

  test('items array is not empty', async () => {
    const items = eventPayload.ecommerce?.items;
    expect(
      items.length > 0,
      'items array must contain at least one item for a purchase event'
    ).toBe(true);
  });

  test('each item has required fields', async () => {
    const items = eventPayload.ecommerce?.items;
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
  });

  test('no duplicate purchase event on page reload', async ({ page }) => {
    // Reload the page to test deduplication logic
    await page.reload();
    await page.waitForTimeout(2000);
    
    const allPurchaseEvents = await getAllDataLayerEvents(page, 'purchase');
    expect(
      allPurchaseEvents.length,
      `purchase event should fire only once (deduplication), but found ${allPurchaseEvents.length} events`
    ).toBe(1);
  });

  test('value equals sum of item prices plus tax and shipping', async () => {
    const ecommerce = eventPayload.ecommerce;
    const items = ecommerce?.items || [];
    const itemsTotal = items.reduce((sum, item) => {
      const price = item.price || 0;
      const quantity = item.quantity || 1;
      return sum + (price * quantity);
    }, 0);
    
    const expectedValue = itemsTotal + (ecommerce?.tax || 0) + (ecommerce?.shipping || 0) - (ecommerce?.discount || 0);
    const actualValue = ecommerce?.value;
    
    // Allow for small floating point differences
    const tolerance = 0.01;
    const difference = Math.abs(actualValue - expectedValue);
    
    expect(
      difference <= tolerance,
      `value (${actualValue}) should approximately equal items total + tax + shipping - discount (${expectedValue}), difference: ${difference}`
    ).toBe(true);
  });
});
