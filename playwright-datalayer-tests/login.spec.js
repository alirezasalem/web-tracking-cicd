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

test.describe('login', () => {
  let eventPayload;

  test.beforeEach(async ({ page }) => {
    await page.goto(process.env.TEST_URL);
    // TODO: confirm selector with engineering - login form selector not specified in spec
    // Attempting to trigger login via form submission
    const loginForm = page.locator('form[action*="login"], form#login, form.login-form, [data-testid="login-form"]');
    const submitButton = page.locator('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    
    // Fill login credentials if fields are present
    const emailField = page.locator('input[type="email"], input[name="email"], input#email');
    const passwordField = page.locator('input[type="password"], input[name="password"], input#password');
    
    if (await emailField.count() > 0) {
      await emailField.first().fill('test@example.com');
    }
    if (await passwordField.count() > 0) {
      await passwordField.first().fill('testpassword123');
    }
    
    await submitButton.first().click();
    eventPayload = await waitForDataLayerEvent(page, 'login');
  });

  test('event fires', async () => {
    expect(eventPayload, 'dataLayer event "login" not found').toBeTruthy();
  });

  test('event name is correct', async () => {
    expect(
      eventPayload.event,
      `event name must be "login", got "${eventPayload.event}"`
    ).toBe('login');
  });

  test('event_category is present and equals "authentication"', async () => {
    expect(
      eventPayload.event_category,
      `event_category must be "authentication", got "${eventPayload.event_category}"`
    ).toBe('authentication');
  });

  test('event_label is present and is a non-empty string', async () => {
    expect(
      eventPayload.event_label !== undefined && eventPayload.event_label !== null,
      `event_label must be present, got ${eventPayload.event_label}`
    ).toBe(true);
    expect(
      typeof eventPayload.event_label === 'string',
      `event_label must be a string, got ${typeof eventPayload.event_label} (value: ${eventPayload.event_label})`
    ).toBe(true);
    expect(
      eventPayload.event_label.length > 0,
      `event_label must be non-empty, got empty string`
    ).toBe(true);
  });

  test('user_id is present and is a non-empty string', async () => {
    expect(
      eventPayload.user_id !== undefined && eventPayload.user_id !== null,
      `user_id must be present, got ${eventPayload.user_id}`
    ).toBe(true);
    expect(
      typeof eventPayload.user_id === 'string',
      `user_id must be a string, got ${typeof eventPayload.user_id} (value: ${eventPayload.user_id})`
    ).toBe(true);
    expect(
      eventPayload.user_id.length > 0,
      `user_id must be non-empty, got empty string`
    ).toBe(true);
  });

  test('method is present and is a non-empty string', async () => {
    expect(
      eventPayload.method !== undefined && eventPayload.method !== null,
      `method must be present, got ${eventPayload.method}`
    ).toBe(true);
    expect(
      typeof eventPayload.method === 'string',
      `method must be a string, got ${typeof eventPayload.method} (value: ${eventPayload.method})`
    ).toBe(true);
    expect(
      eventPayload.method.length > 0,
      `method must be non-empty, got empty string`
    ).toBe(true);
  });

  test('user_id is not a cleartext email (PII mitigation)', async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(
      !emailRegex.test(eventPayload.user_id),
      `user_id must be hashed or internal ID, not cleartext email. Got: ${eventPayload.user_id}`
    ).toBe(true);
  });

  test('user_id is not a cleartext username format (PII mitigation)', async () => {
    // Check that user_id appears to be a hash or numeric ID, not a plain username
    // Hashes are typically alphanumeric and longer than typical usernames
    const looksLikeHash = /^[a-f0-9]{32,}$/i.test(eventPayload.user_id) || 
                          /^[a-zA-Z0-9+/=]{20,}$/.test(eventPayload.user_id) ||
                          /^\d+$/.test(eventPayload.user_id);
    expect(
      looksLikeHash,
      `user_id should be hashed or internal database ID, got potentially cleartext value: ${eventPayload.user_id}`
    ).toBe(true);
  });

  test('user_id does not contain phone number pattern (PII mitigation)', async () => {
    const phoneRegex = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
    expect(
      !phoneRegex.test(eventPayload.user_id),
      `user_id must not contain phone number. Got: ${eventPayload.user_id}`
    ).toBe(true);
  });

  test('event_label matches method value', async () => {
    expect(
      eventPayload.event_label,
      `event_label should match method value. event_label: ${eventPayload.event_label}, method: ${eventPayload.method}`
    ).toBe(eventPayload.method);
  });
});
