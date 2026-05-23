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

test.describe('page_view', () => {
  let eventPayload;

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.TEST_URL);
    eventPayload = await waitForDataLayerEvent(page, 'page_view');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event page_view not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name should be "page_view", got "${eventPayload.event}"`
    ).toBe('page_view');
  });

  test('event_category equals "navigation"', async () => {
    expect(
      eventPayload.event_category,
      `event_category should be "navigation", got "${eventPayload.event_category}"`
    ).toBe('navigation');
  });

  test('event_label is present and is a string', async () => {
    expect(
      eventPayload.event_label !== undefined && eventPayload.event_label !== null,
      `event_label should be present, got ${eventPayload.event_label}`
    ).toBe(true);
    expect(
      typeof eventPayload.event_label === 'string',
      `event_label must be a string, got ${typeof eventPayload.event_label} (value: ${eventPayload.event_label})`
    ).toBe(true);
  });

  test('page_location is present and is a non-empty string', async () => {
    expect(
      eventPayload.page_location !== undefined && eventPayload.page_location !== null,
      `page_location should be present, got ${eventPayload.page_location}`
    ).toBe(true);
    expect(
      typeof eventPayload.page_location === 'string',
      `page_location must be a string, got ${typeof eventPayload.page_location} (value: ${eventPayload.page_location})`
    ).toBe(true);
    expect(
      eventPayload.page_location.length > 0,
      `page_location must be non-empty, got "${eventPayload.page_location}"`
    ).toBe(true);
  });

  test('page_location does not contain PII (email)', async () => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    expect(
      !emailRegex.test(eventPayload.page_location),
      `page_location should not contain email PII, got "${eventPayload.page_location}"`
    ).toBe(true);
  });

  test('page_referrer is present and is a string', async () => {
    expect(
      eventPayload.page_referrer !== undefined,
      `page_referrer should be present, got ${eventPayload.page_referrer}`
    ).toBe(true);
    expect(
      typeof eventPayload.page_referrer === 'string',
      `page_referrer must be a string, got ${typeof eventPayload.page_referrer} (value: ${eventPayload.page_referrer})`
    ).toBe(true);
  });

  test('page_title is present and is a non-empty string', async () => {
    expect(
      eventPayload.page_title !== undefined && eventPayload.page_title !== null,
      `page_title should be present, got ${eventPayload.page_title}`
    ).toBe(true);
    expect(
      typeof eventPayload.page_title === 'string',
      `page_title must be a string, got ${typeof eventPayload.page_title} (value: ${eventPayload.page_title})`
    ).toBe(true);
    expect(
      eventPayload.page_title.length > 0,
      `page_title must be non-empty, got "${eventPayload.page_title}"`
    ).toBe(true);
  });

  test('user_id is present and is a string', async () => {
    expect(
      eventPayload.user_id !== undefined,
      `user_id should be present, got ${eventPayload.user_id}`
    ).toBe(true);
    expect(
      typeof eventPayload.user_id === 'string',
      `user_id must be a string, got ${typeof eventPayload.user_id} (value: ${eventPayload.user_id})`
    ).toBe(true);
  });

  test('user_id does not contain PII (unhashed email)', async () => {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    expect(
      !emailRegex.test(eventPayload.user_id),
      `user_id should not be an unhashed email, got "${eventPayload.user_id}"`
    ).toBe(true);
  });

  test('user_id does not contain PII (phone number)', async () => {
    const phoneRegex = /^\+?[\d\s()-]{10,}$/;
    expect(
      !phoneRegex.test(eventPayload.user_id),
      `user_id should not be a phone number, got "${eventPayload.user_id}"`
    ).toBe(true);
  });

  test('device_type is present and is a non-empty string', async () => {
    expect(
      eventPayload.device_type !== undefined && eventPayload.device_type !== null,
      `device_type should be present, got ${eventPayload.device_type}`
    ).toBe(true);
    expect(
      typeof eventPayload.device_type === 'string',
      `device_type must be a string, got ${typeof eventPayload.device_type} (value: ${eventPayload.device_type})`
    ).toBe(true);
    expect(
      eventPayload.device_type.length > 0,
      `device_type must be non-empty, got "${eventPayload.device_type}"`
    ).toBe(true);
  });
});
