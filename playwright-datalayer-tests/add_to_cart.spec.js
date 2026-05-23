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

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('add_to_cart', () => {
  let eventPayload;

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.TEST_URL);
    // Trigger add to cart interaction
    const addToCartButton = page.locator('.add-to-cart, [data-action="add-to-cart"]').first();
    await addToCartButton.click();
    eventPayload = await waitForDataLayerEvent(page, 'add_to_cart');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event "add_to_cart" not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name should be "add_to_cart", got "${eventPayload.event}"`
    ).toBe('add_to_cart');
  });

  test('ecommerce object is present', async () => {
    expect(
      eventPayload.ecommerce !== undefined && eventPayload.ecommerce !== null,
      `ecommerce object must be present, got ${typeof eventPayload.ecommerce}`
    ).toBe(true);
  });

  test('ecommerce.currency is a non-empty string', async () => {
    const currency = eventPayload.ecommerce?.currency;
    expect(
      typeof currency === 'string' && currency.length > 0,
      `ecommerce.currency must be a non-empty string, got ${typeof currency} (value: ${currency})`
    ).toBe(true);
  });

  test('ecommerce.value is a number', async () => {
    const value = eventPayload.ecommerce?.value;
    expect(
      typeof value === 'number' && !isNaN(value),
      `ecommerce.value must be a number, got ${typeof value} (value: ${value})`
    ).toBe(true);
  });

  test('ecommerce.items is a non-empty array', async () => {
    const items = eventPayload.ecommerce?.items;
    expect(
      Array.isArray(items) && items.length > 0,
      `ecommerce.items must be a non-empty array, got ${typeof items} (value: ${JSON.stringify(items)})`
    ).toBe(true);
  });

  test('ecommerce.items[0].item_id is a non-empty string', async () => {
    const itemId = eventPayload.ecommerce?.items?.[0]?.item_id;
    expect(
      typeof itemId === 'string' && itemId.length > 0,
      `ecommerce.items[0].item_id must be a non-empty string, got ${typeof itemId} (value: ${itemId})`
    ).toBe(true);
  });

  test('ecommerce.items[0].item_name is a non-empty string', async () => {
    const itemName = eventPayload.ecommerce?.items?.[0]?.item_name;
    expect(
      typeof itemName === 'string' && itemName.length > 0,
      `ecommerce.items[0].item_name must be a non-empty string, got ${typeof itemName} (value: ${itemName})`
    ).toBe(true);
  });

  test('ecommerce.items[0].item_category is a non-empty string', async () => {
    const itemCategory = eventPayload.ecommerce?.items?.[0]?.item_category;
    expect(
      typeof itemCategory === 'string' && itemCategory.length > 0,
      `ecommerce.items[0].item_category must be a non-empty string, got ${typeof itemCategory} (value: ${itemCategory})`
    ).toBe(true);
  });

  test('ecommerce.items[0].item_variant is a non-empty string', async () => {
    const itemVariant = eventPayload.ecommerce?.items?.[0]?.item_variant;
    expect(
      typeof itemVariant === 'string' && itemVariant.length > 0,
      `ecommerce.items[0].item_variant must be a non-empty string, got ${typeof itemVariant} (value: ${itemVariant})`
    ).toBe(true);
  });

  test('ecommerce.items[0].price is a number', async () => {
    const price = eventPayload.ecommerce?.items?.[0]?.price;
    expect(
      typeof price === 'number' && !isNaN(price),
      `ecommerce.items[0].price must be a number, got ${typeof price} (value: ${price})`
    ).toBe(true);
  });

  test('ecommerce.items[0].quantity is a number', async () => {
    const quantity = eventPayload.ecommerce?.items?.[0]?.quantity;
    expect(
      typeof quantity === 'number' && !isNaN(quantity),
      `ecommerce.items[0].quantity must be a number, got ${typeof quantity} (value: ${quantity})`
    ).toBe(true);
  });

  test('ecommerce.items[0].quantity is a positive integer', async () => {
    const quantity = eventPayload.ecommerce?.items?.[0]?.quantity;
    expect(
      Number.isInteger(quantity) && quantity > 0,
      `ecommerce.items[0].quantity must be a positive integer, got ${quantity}`
    ).toBe(true);
  });

  test('ecommerce.items[0].price is non-negative', async () => {
    const price = eventPayload.ecommerce?.items?.[0]?.price;
    expect(
      typeof price === 'number' && price >= 0,
      `ecommerce.items[0].price must be non-negative, got ${price}`
    ).toBe(true);
  });

  test('ecommerce.value matches item price times quantity', async () => {
    const value = eventPayload.ecommerce?.value;
    const price = eventPayload.ecommerce?.items?.[0]?.price;
    const quantity = eventPayload.ecommerce?.items?.[0]?.quantity;
    const expectedValue = price * quantity;
    expect(
      Math.abs(value - expectedValue) < 0.01,
      `ecommerce.value (${value}) should match price (${price}) * quantity (${quantity}) = ${expectedValue}`
    ).toBe(true);
  });

  test('ecommerce.currency is a valid ISO 4217 currency code format', async () => {
    const currency = eventPayload.ecommerce?.currency;
    const isoPattern = /^[A-Z]{3}$/;
    expect(
      isoPattern.test(currency),
      `ecommerce.currency must be a valid ISO 4217 currency code (3 uppercase letters), got "${currency}"`
    ).toBe(true);
  });
});
