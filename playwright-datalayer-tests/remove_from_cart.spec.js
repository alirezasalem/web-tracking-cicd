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

test.describe('remove_from_cart', () => {
  let eventPayload;
  let page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto(process.env.TEST_URL);
    await page.locator('[data-testid="remove-item-btn"]').first().click();
    eventPayload = await waitForDataLayerEvent(page, 'remove_from_cart');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name should be "remove_from_cart", got "${eventPayload.event}"`
    ).toBe('remove_from_cart');
  });

  // ── currency parameter ──────────────────────────────────────────────────────

  test('currency parameter is present', async () => {
    expect(
      eventPayload.currency !== undefined && eventPayload.currency !== null,
      `currency must be present, got ${eventPayload.currency}`
    ).toBe(true);
  });

  test('currency parameter is a string', async () => {
    expect(
      typeof eventPayload.currency === 'string',
      `currency must be a string, got ${typeof eventPayload.currency} (value: ${eventPayload.currency})`
    ).toBe(true);
  });

  test('currency parameter is a valid 3-letter code', async () => {
    expect(
      /^[A-Z]{3}$/.test(eventPayload.currency),
      `currency must be a 3-letter code (e.g., USD), got "${eventPayload.currency}"`
    ).toBe(true);
  });

  // ── value parameter ─────────────────────────────────────────────────────────

  test('value parameter is present', async () => {
    expect(
      eventPayload.value !== undefined && eventPayload.value !== null,
      `value must be present, got ${eventPayload.value}`
    ).toBe(true);
  });

  test('value parameter is a number', async () => {
    expect(
      typeof eventPayload.value === 'number' && !isNaN(eventPayload.value),
      `value must be a number, got ${typeof eventPayload.value} (value: ${eventPayload.value})`
    ).toBe(true);
  });

  test('value parameter is non-negative', async () => {
    expect(
      eventPayload.value >= 0,
      `value must be non-negative, got ${eventPayload.value}`
    ).toBe(true);
  });

  // ── items parameter ─────────────────────────────────────────────────────────

  test('items parameter is present', async () => {
    expect(
      eventPayload.items !== undefined && eventPayload.items !== null,
      `items must be present, got ${eventPayload.items}`
    ).toBe(true);
  });

  test('items parameter is an array', async () => {
    expect(
      Array.isArray(eventPayload.items),
      `items must be an array, got ${typeof eventPayload.items} (value: ${JSON.stringify(eventPayload.items)})`
    ).toBe(true);
  });

  test('items array is not empty', async () => {
    expect(
      eventPayload.items.length > 0,
      `items array must not be empty, got ${eventPayload.items.length} items`
    ).toBe(true);
  });

  test('items array contains objects with item_id', async () => {
    const allHaveItemId = eventPayload.items.every(item => 
      item.item_id !== undefined && item.item_id !== null
    );
    expect(
      allHaveItemId,
      `all items must have item_id, got items: ${JSON.stringify(eventPayload.items)}`
    ).toBe(true);
  });

  test('items array contains objects with item_name', async () => {
    const allHaveItemName = eventPayload.items.every(item => 
      item.item_name !== undefined && item.item_name !== null
    );
    expect(
      allHaveItemName,
      `all items must have item_name, got items: ${JSON.stringify(eventPayload.items)}`
    ).toBe(true);
  });

  test('items array contains objects with price as number', async () => {
    const allHaveValidPrice = eventPayload.items.every(item => 
      typeof item.price === 'number' && !isNaN(item.price)
    );
    expect(
      allHaveValidPrice,
      `all items must have numeric price, got items: ${JSON.stringify(eventPayload.items)}`
    ).toBe(true);
  });

  test('items array contains objects with quantity as number', async () => {
    const allHaveValidQuantity = eventPayload.items.every(item => 
      typeof item.quantity === 'number' && !isNaN(item.quantity) && item.quantity > 0
    );
    expect(
      allHaveValidQuantity,
      `all items must have positive numeric quantity, got items: ${JSON.stringify(eventPayload.items)}`
    ).toBe(true);
  });

  // ── cart_value_before parameter (optional) ──────────────────────────────────

  test('cart_value_before is a number when present', async () => {
    if (eventPayload.cart_value_before !== undefined && eventPayload.cart_value_before !== null) {
      expect(
        typeof eventPayload.cart_value_before === 'number' && !isNaN(eventPayload.cart_value_before),
        `cart_value_before must be a number when present, got ${typeof eventPayload.cart_value_before} (value: ${eventPayload.cart_value_before})`
      ).toBe(true);
    }
  });

  test('cart_value_before is non-negative when present', async () => {
    if (eventPayload.cart_value_before !== undefined && eventPayload.cart_value_before !== null) {
      expect(
        eventPayload.cart_value_before >= 0,
        `cart_value_before must be non-negative when present, got ${eventPayload.cart_value_before}`
      ).toBe(true);
    }
  });

  // ── cart_value_after parameter (optional) ───────────────────────────────────

  test('cart_value_after is a number when present', async () => {
    if (eventPayload.cart_value_after !== undefined && eventPayload.cart_value_after !== null) {
      expect(
        typeof eventPayload.cart_value_after === 'number' && !isNaN(eventPayload.cart_value_after),
        `cart_value_after must be a number when present, got ${typeof eventPayload.cart_value_after} (value: ${eventPayload.cart_value_after})`
      ).toBe(true);
    }
  });

  test('cart_value_after is non-negative when present', async () => {
    if (eventPayload.cart_value_after !== undefined && eventPayload.cart_value_after !== null) {
      expect(
        eventPayload.cart_value_after >= 0,
        `cart_value_after must be non-negative when present, got ${eventPayload.cart_value_after}`
      ).toBe(true);
    }
  });

  // ── business rules ──────────────────────────────────────────────────────────

  test('no duplicate events on rapid clicking', async () => {
    // Reset and test rapid clicking scenario
    await page.goto(process.env.TEST_URL);
    
    const removeButton = page.locator('[data-testid="remove-item-btn"]').first();
    
    // Rapid click simulation
    await removeButton.click();
    await removeButton.click({ delay: 50 });
    await removeButton.click({ delay: 50 });
    
    // Wait a moment for any events to settle
    await page.waitForTimeout(1000);
    
    const allEvents = await getAllDataLayerEvents(page, 'remove_from_cart');
    
    expect(
      allEvents.length === 1,
      `expected exactly 1 remove_from_cart event after rapid clicking, got ${allEvents.length} events`
    ).toBe(true);
  });

  test('value matches sum of removed items prices', async () => {
    const calculatedValue = eventPayload.items.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);
    
    // Allow small floating point tolerance
    const tolerance = 0.01;
    const valueDiff = Math.abs(eventPayload.value - calculatedValue);
    
    expect(
      valueDiff <= tolerance,
      `value (${eventPayload.value}) should equal sum of item prices*quantities (${calculatedValue}), difference: ${valueDiff}`
    ).toBe(true);
  });
});
