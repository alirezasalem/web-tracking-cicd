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
    expect(eventPayload, 'dataLayer event add_to_cart not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name must be "add_to_cart", got "${eventPayload.event}"`
    ).toBe('add_to_cart');
  });

  // ── ecommerce object tests ──────────────────────────────────────────────────

  test('ecommerce object is present', async () => {
    expect(
      eventPayload.ecommerce,
      'ecommerce object must be present in dataLayer event'
    ).toBeTruthy();
  });

  test('ecommerce.currency is present and is a string', async () => {
    expect(
      eventPayload.ecommerce?.currency !== undefined && eventPayload.ecommerce?.currency !== null,
      `ecommerce.currency must be present, got ${eventPayload.ecommerce?.currency}`
    ).toBe(true);
    expect(
      typeof eventPayload.ecommerce?.currency === 'string',
      `ecommerce.currency must be a string, got ${typeof eventPayload.ecommerce?.currency} (value: ${eventPayload.ecommerce?.currency})`
    ).toBe(true);
  });

  test('ecommerce.currency is a non-empty string', async () => {
    expect(
      eventPayload.ecommerce?.currency?.length > 0,
      `ecommerce.currency must be a non-empty string, got "${eventPayload.ecommerce?.currency}"`
    ).toBe(true);
  });

  test('ecommerce.value is present', async () => {
    expect(
      eventPayload.ecommerce?.value !== undefined && eventPayload.ecommerce?.value !== null,
      `ecommerce.value must be present, got ${eventPayload.ecommerce?.value}`
    ).toBe(true);
  });

  test('ecommerce.value is a number', async () => {
    const value = eventPayload.ecommerce?.value;
    expect(
      typeof value === 'number' && !isNaN(value),
      `ecommerce.value must be a number, got ${typeof value} (value: ${value})`
    ).toBe(true);
  });

  // ── products array tests ────────────────────────────────────────────────────

  test('ecommerce.products is present and is an array', async () => {
    expect(
      Array.isArray(eventPayload.ecommerce?.products),
      `ecommerce.products must be an array, got ${typeof eventPayload.ecommerce?.products}`
    ).toBe(true);
  });

  test('ecommerce.products has at least one item', async () => {
    expect(
      eventPayload.ecommerce?.products?.length > 0,
      `ecommerce.products must have at least one item, got ${eventPayload.ecommerce?.products?.length} items`
    ).toBe(true);
  });

  // ── first product item tests ────────────────────────────────────────────────

  test('product item_id is present and is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    expect(
      product?.item_id !== undefined && product?.item_id !== null,
      `product.item_id must be present, got ${product?.item_id}`
    ).toBe(true);
    expect(
      typeof product?.item_id === 'string' && product?.item_id.length > 0,
      `product.item_id must be a non-empty string, got ${typeof product?.item_id} (value: ${product?.item_id})`
    ).toBe(true);
  });

  test('product item_name is present and is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    expect(
      product?.item_name !== undefined && product?.item_name !== null,
      `product.item_name must be present, got ${product?.item_name}`
    ).toBe(true);
    expect(
      typeof product?.item_name === 'string' && product?.item_name.length > 0,
      `product.item_name must be a non-empty string, got ${typeof product?.item_name} (value: ${product?.item_name})`
    ).toBe(true);
  });

  test('product item_category is present and is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    expect(
      product?.item_category !== undefined && product?.item_category !== null,
      `product.item_category must be present, got ${product?.item_category}`
    ).toBe(true);
    expect(
      typeof product?.item_category === 'string' && product?.item_category.length > 0,
      `product.item_category must be a non-empty string, got ${typeof product?.item_category} (value: ${product?.item_category})`
    ).toBe(true);
  });

  test('product item_variant is present and is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    expect(
      product?.item_variant !== undefined && product?.item_variant !== null,
      `product.item_variant must be present, got ${product?.item_variant}`
    ).toBe(true);
    expect(
      typeof product?.item_variant === 'string' && product?.item_variant.length > 0,
      `product.item_variant must be a non-empty string, got ${typeof product?.item_variant} (value: ${product?.item_variant})`
    ).toBe(true);
  });

  test('product price is present', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    expect(
      product?.price !== undefined && product?.price !== null,
      `product.price must be present, got ${product?.price}`
    ).toBe(true);
  });

  test('product price is a number', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const price = product?.price;
    expect(
      typeof price === 'number' && !isNaN(price),
      `product.price must be a number, got ${typeof price} (value: ${price})`
    ).toBe(true);
  });

  test('product quantity is present', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    expect(
      product?.quantity !== undefined && product?.quantity !== null,
      `product.quantity must be present, got ${product?.quantity}`
    ).toBe(true);
  });

  test('product quantity is a number', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const quantity = product?.quantity;
    expect(
      typeof quantity === 'number' && !isNaN(quantity),
      `product.quantity must be a number, got ${typeof quantity} (value: ${quantity})`
    ).toBe(true);
  });

  test('product quantity is a positive integer', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const quantity = product?.quantity;
    expect(
      Number.isInteger(quantity) && quantity > 0,
      `product.quantity must be a positive integer, got ${quantity}`
    ).toBe(true);
  });

  // ── business rule: ecommerce.value matches product price * quantity ─────────

  test('ecommerce.value equals product price multiplied by quantity', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const expectedValue = product?.price * product?.quantity;
    const actualValue = eventPayload.ecommerce?.value;
    expect(
      Math.abs(actualValue - expectedValue) < 0.01,
      `ecommerce.value should equal price * quantity (expected: ${expectedValue}, got: ${actualValue})`
    ).toBe(true);
  });
});
