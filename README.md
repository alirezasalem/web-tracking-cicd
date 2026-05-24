# Analytics CI/CD

> AI-native analytics pipeline — from feature brief to validated production tracking, with zero manual toil.

Built as a reference implementation for the Senior/Staff Web Analyst role at Visable.

## What this system does

1. Generates a fully-structured tracking spec via Claude MCP
2. Lints the spec against conventions.yaml — blocking merge on any violation
3. Produces four artifacts in parallel: JSON Schema, Playwright tests, GTM config, impl card
4. Validates tracking in CI before any code reaches staging
5. Deploys GTM workspace changes to staging automatically on merge
6. Monitors production with a Live Truth dashboard — sub-5-minute latency
7. Blocks regressions via Anti-Corruption release gates

## Stack

| Area | Tools |
|---|---|
| Frontend | React, Nuxt 3 |
| Tracking spec | YAML, JSON Schema |
| AI agent | Claude, MCP |
| Validation | Playwright, GitHub Actions |
| GTM | Client-side + Server-side containers |
| CI/CD | GitHub Actions |
| Monitoring | Node.js, GA4 Data API |

## Status

| Step | Status |
|---|---|
| Repo scaffold + Git workflow | Done |
| conventions.yaml + spec linter | Next |
| Claude MCP setup | Planned |
| Spec workflow | Planned |
| AI artifact generation | Planned |
| CI pipeline | Planned |
| sGTM architecture | Planned |
| Live Truth monitoring | Planned |
| Anti-Corruption release gates | Planned |
| Self-service platform | Planned |

*Built by Alireza Salem*
