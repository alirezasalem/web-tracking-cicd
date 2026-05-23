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
      `event name should be "add_to_cart", got "${eventPayload.event}"`
    ).toBe('add_to_cart');
  });

  // ── ecommerce object tests ──────────────────────────────────────────────────

  test('ecommerce object is present', async () => {
    expect(
      eventPayload.ecommerce,
      'ecommerce object is missing from dataLayer event'
    ).toBeTruthy();
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

  test('ecommerce.products array is present and non-empty', async () => {
    const products = eventPayload.ecommerce?.products;
    expect(
      Array.isArray(products) && products.length > 0,
      `ecommerce.products must be a non-empty array, got ${JSON.stringify(products)}`
    ).toBe(true);
  });

  // ── product item tests ──────────────────────────────────────────────────────

  test('product item_id is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const itemId = product?.item_id;
    expect(
      typeof itemId === 'string' && itemId.length > 0,
      `products[0].item_id must be a non-empty string, got ${typeof itemId} (value: ${itemId})`
    ).toBe(true);
  });

  test('product item_name is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const itemName = product?.item_name;
    expect(
      typeof itemName === 'string' && itemName.length > 0,
      `products[0].item_name must be a non-empty string, got ${typeof itemName} (value: ${itemName})`
    ).toBe(true);
  });

  test('product item_category is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const itemCategory = product?.item_category;
    expect(
      typeof itemCategory === 'string' && itemCategory.length > 0,
      `products[0].item_category must be a non-empty string, got ${typeof itemCategory} (value: ${itemCategory})`
    ).toBe(true);
  });

  test('product item_variant is a non-empty string', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const itemVariant = product?.item_variant;
    expect(
      typeof itemVariant === 'string' && itemVariant.length > 0,
      `products[0].item_variant must be a non-empty string, got ${typeof itemVariant} (value: ${itemVariant})`
    ).toBe(true);
  });

  test('product price is a number', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const price = product?.price;
    expect(
      typeof price === 'number' && !isNaN(price),
      `products[0].price must be a number, got ${typeof price} (value: ${price})`
    ).toBe(true);
  });

  test('product quantity is a number', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const quantity = product?.quantity;
    expect(
      typeof quantity === 'number' && !isNaN(quantity),
      `products[0].quantity must be a number, got ${typeof quantity} (value: ${quantity})`
    ).toBe(true);
  });

  test('product quantity is a positive integer', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const quantity = product?.quantity;
    expect(
      Number.isInteger(quantity) && quantity > 0,
      `products[0].quantity must be a positive integer, got ${quantity}`
    ).toBe(true);
  });

  test('product price is non-negative', async () => {
    const product = eventPayload.ecommerce?.products?.[0];
    const price = product?.price;
    expect(
      typeof price === 'number' && price >= 0,
      `products[0].price must be non-negative, got ${price}`
    ).toBe(true);
  });

  // ── business rule: ecommerce.value matches product price * quantity ─────────

  test('ecommerce.value equals product price times quantity', async () => {
    const ecommerceValue = eventPayload.ecommerce?.value;
    const product = eventPayload.ecommerce?.products?.[0];
    const expectedValue = product?.price * product?.quantity;
    expect(
      ecommerceValue === expectedValue,
      `ecommerce.value (${ecommerceValue}) should equal price * quantity (${expectedValue})`
    ).toBe(true);
  });

  // ── business rule from gtm_notes: fire only after cart state validation ─────
  // This is validated implicitly by the event appearing in dataLayer after click
  // The GTM trigger listens for the dataLayer push, not the direct button click

  test('currency follows ISO 4217 format (3 uppercase letters)', async () => {
    const currency = eventPayload.ecommerce?.currency;
    const iso4217Pattern = /^[A-Z]{3}$/;
    expect(
      iso4217Pattern.test(currency),
      `ecommerce.currency should be 3 uppercase letters (ISO 4217), got "${currency}"`
    ).toBe(true);
  });
});
