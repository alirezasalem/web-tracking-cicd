# Feature Brief
# ─────────────────────────────────────────────────────────────────────────────
# Save as:  specs/briefs/FB-add-shipping-info-tracking.md
# Example:  FB-checkout-flow.md  ·  FB-user-login.md  ·  FB-product-search.md
# Upload:   specs/briefs/ via GitHub browser UI — no Git needed
# Note:     Do not rename section headings — the AI agent reads them by name
# ─────────────────────────────────────────────────────────────────────────────

---
title: "Add Shipping Info Tracking Implementation"
status: draft
version: "1.0"
author: "Product Analytics Team"
owner_team: "Data & Analytics"
priority: "P0"          # P0 = blocks release · P1 = this sprint · P2 = nice to have
target_sprint: "Sprint 12 (Q2 2026)"
reviewer_analyst: "Lead Web Analyst"
reviewer_engineer: "Frontend Lead" # optional
related_briefs: [FB-page-view-tracking, FB-begin-checkout-tracking]    # optional
---


## Background

The submission of shipping information is a major drop-off point in the e-commerce purchase funnel. Users often abandon the process here due to form complexity, lack of acceptable delivery methods, or unexpected shipping costs. Tracking the successful submission of shipping details allows us to measure checkout step progression accurately and analyze how different shipping methods or costs influence the final conversion rate.


## Feature description

The event tracking will capture successful shipping address and delivery option confirmation within the checkout flow.

1. **User Action:** The user inputs their shipping address details and selects their preferred delivery tier (e.g., Standard, Express) on the checkout shipping step.
2. **Form Submission:** The user clicks the "Continue to Payment" or "Save Shipping" button. The application validates the address fields and confirms form acceptance via the backend API.
3. **Dispatch:** The moment the application state updates to confirm the shipping data is successfully attached to the active order session, the event fires with the selected shipping tier and cart metadata before advancing the user to the payment step.


## Business questions

- What percentage of users who begin checkout drop off precisely at the shipping configuration step?
- Which shipping methods (e.g., standard vs. express) are selected most frequently by users, and do they correlate with higher order values?
- Does the presence of a shipping fee correlate with increased cart abandonment rates on this step?


## Events to track

### Event: add_shipping_info

**When it fires:** Immediately after the checkout application successfully validates and saves the user's shipping/delivery information (e.g., upon a successful API 200 response from the shipping validation endpoint). It must *not* fire on the raw button click if form validation fails.

**Data to capture:**
- `shipping_tier`: The delivery method selected by the user (e.g., "standard", "express", "next_day", "store_pickup")
- `value`: The total monetary value of the cart items combined (numeric value, excluding shipping/tax unless pre-calculated)
- `currency`: The active currency code (e.g., "EUR")
- `coupon`: The coupon code applied to the order (pass null or empty string if none)
- `items`: An array of objects representing each product in the cart, containing:
  - `product_id`
  - `product_name`
  - `price`
  - `quantity`
  - `variant`

**Priority:** P0

**Edge cases:** - **Express Checkouts / Digital Goods:** For express payment methods (e.g., Apple Pay) or orders containing entirely digital products that bypass the manual shipping step, the `add_shipping_info` event must still be triggered programmatically in sequence with the other checkout events, using a value like `shipping_tier: "digital"` or `"express_checkout"`.
- **Address Edits:** If a user progresses to the payment step but navigates back to edit and resubmit their shipping information, a second `add_shipping_info` event should fire to reflect the updated state.
- **Billing vs. Shipping:** This event is strictly for the *delivery/shipping* address configuration, not the billing address step (which is typically tied to payment details).

---


## Scope

**In scope:**
- Successful validation and submission of delivery addresses and shipping options within the web responsive checkout funnel.
- Web-based desktop, tablet, and mobile layouts.

**Out of scope:**
- Tracking individual keystrokes or validation errors within specific address form fields (e.g., zip code format errors).
- Native mobile application checkout paths.


## Risks

| Risk | Notes |
|------|-------|
| PII Exposure | **Strictly Prohibited:** Do not pass cleartext names, street addresses, phone numbers, or exact coordinates into the event parameters. Only generic metadata like the `shipping_tier` string is allowed. (Geographic analysis should rely on aggregate backend IP-to-country/city translation or broad postal code routing if anonymized). |
| Validation State Desync | Firing the event on a simple button click before the address validation API returns a successful response will result in artificially high step-completion rates. |


## Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Product Manager | | | ☐ |
| Web Analyst | | | ☐ |
