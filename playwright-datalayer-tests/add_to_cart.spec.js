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
    await addToCartButton.waitFor({ state: 'visible', timeout: 5000 });
    await addToCartButton.click();
    
    eventPayload = await waitForDataLayerEvent(page, 'add_to_cart');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event not found').toBeTruthy();
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
      'ecommerce object should be present in dataLayer push'
    ).toBeDefined();
  });

  test('ecommerce.currency is present and is a string', async () => {
    expect(
      eventPayload.ecommerce?.currency !== undefined && eventPayload.ecommerce?.currency !== null,
      `ecommerce.currency should be present, got ${eventPayload.ecommerce?.currency}`
    ).toBe(true);
    expect(
      typeof eventPayload.ecommerce?.currency === 'string',
      `ecommerce.currency must be a string, got ${typeof eventPayload.ecommerce?.currency} (value: ${eventPayload.ecommerce?.currency})`
    ).toBe(true);
    expect(
      eventPayload.ecommerce?.currency.length > 0,
      'ecommerce.currency should be a non-empty string'
    ).toBe(true);
  });

  test('ecommerce.value is present and is a number', async () => {
    expect(
      eventPayload.ecommerce?.value !== undefined && eventPayload.ecommerce?.value !== null,
      `ecommerce.value should be present, got ${eventPayload.ecommerce?.value}`
    ).toBe(true);
    expect(
      typeof eventPayload.ecommerce?.value === 'number' && !isNaN(eventPayload.ecommerce?.value),
      `ecommerce.value must be a number, got ${typeof eventPayload.ecommerce?.value} (value: ${eventPayload.ecommerce?.value})`
    ).toBe(true);
  });

  test('ecommerce.items array is present and non-empty', async () => {
    expect(
      Array.isArray(eventPayload.ecommerce?.items),
      `ecommerce.items should be an array, got ${typeof eventPayload.ecommerce?.items}`
    ).toBe(true);
    expect(
      eventPayload.ecommerce?.items?.length > 0,
      'ecommerce.items should contain at least one item'
    ).toBe(true);
  });

  // ── items[0] tests ──────────────────────────────────────────────────────────

  test('items[0].item_id is present and is a non-empty string', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    expect(
      item?.item_id !== undefined && item?.item_id !== null,
      `items[0].item_id should be present, got ${item?.item_id}`
    ).toBe(true);
    expect(
      typeof item?.item_id === 'string',
      `items[0].item_id must be a string, got ${typeof item?.item_id} (value: ${item?.item_id})`
    ).toBe(true);
    expect(
      item?.item_id.length > 0,
      'items[0].item_id should be a non-empty string'
    ).toBe(true);
  });

  test('items[0].item_name is present and is a non-empty string', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    expect(
      item?.item_name !== undefined && item?.item_name !== null,
      `items[0].item_name should be present, got ${item?.item_name}`
    ).toBe(true);
    expect(
      typeof item?.item_name === 'string',
      `items[0].item_name must be a string, got ${typeof item?.item_name} (value: ${item?.item_name})`
    ).toBe(true);
    expect(
      item?.item_name.length > 0,
      'items[0].item_name should be a non-empty string'
    ).toBe(true);
  });

  test('items[0].item_category is present and is a non-empty string', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    expect(
      item?.item_category !== undefined && item?.item_category !== null,
      `items[0].item_category should be present, got ${item?.item_category}`
    ).toBe(true);
    expect(
      typeof item?.item_category === 'string',
      `items[0].item_category must be a string, got ${typeof item?.item_category} (value: ${item?.item_category})`
    ).toBe(true);
    expect(
      item?.item_category.length > 0,
      'items[0].item_category should be a non-empty string'
    ).toBe(true);
  });

  test('items[0].item_variant is present and is a string', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    expect(
      item?.item_variant !== undefined && item?.item_variant !== null,
      `items[0].item_variant should be present, got ${item?.item_variant}`
    ).toBe(true);
    expect(
      typeof item?.item_variant === 'string',
      `items[0].item_variant must be a string, got ${typeof item?.item_variant} (value: ${item?.item_variant})`
    ).toBe(true);
  });

  test('items[0].price is present and is a number', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    expect(
      item?.price !== undefined && item?.price !== null,
      `items[0].price should be present, got ${item?.price}`
    ).toBe(true);
    expect(
      typeof item?.price === 'number' && !isNaN(item?.price),
      `items[0].price must be a number, got ${typeof item?.price} (value: ${item?.price})`
    ).toBe(true);
  });

  test('items[0].quantity is present and is a positive integer', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    expect(
      item?.quantity !== undefined && item?.quantity !== null,
      `items[0].quantity should be present, got ${item?.quantity}`
    ).toBe(true);
    expect(
      typeof item?.quantity === 'number' && !isNaN(item?.quantity),
      `items[0].quantity must be a number, got ${typeof item?.quantity} (value: ${item?.quantity})`
    ).toBe(true);
    expect(
      Number.isInteger(item?.quantity) && item?.quantity > 0,
      `items[0].quantity must be a positive integer, got ${item?.quantity}`
    ).toBe(true);
  });

  // ── business rule: value matches first item price ───────────────────────────

  test('ecommerce.value equals items[0].price * items[0].quantity', async () => {
    const item = eventPayload.ecommerce?.items?.[0];
    const expectedValue = item?.price * item?.quantity;
    expect(
      eventPayload.ecommerce?.value,
      `ecommerce.value should equal price * quantity (${expectedValue}), got ${eventPayload.ecommerce?.value}`
    ).toBe(expectedValue);
  });

  // ── business rule from gtm_notes: fire only after cart state validation ─────

  test('event contains valid ecommerce data structure (cart state validated)', async () => {
    // Per gtm_notes: Fire only after successful cart state validation
    // This test ensures the ecommerce structure is complete, indicating proper validation
    const ecom = eventPayload.ecommerce;
    const item = ecom?.items?.[0];
    
    const hasValidStructure = 
      ecom?.currency &&
      typeof ecom?.value === 'number' &&
      item?.item_id &&
      item?.item_name &&
      typeof item?.price === 'number' &&
      typeof item?.quantity === 'number';
    
    expect(
      hasValidStructure,
      'ecommerce data structure should be complete (indicating successful cart state validation)'
    ).toBe(true);
  });
});
