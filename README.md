# Web Tracking CI/CD

> An AI-native pipeline for analytics tracking — from product manager brief to validated GTM container in production, with humans reviewing instead of writing.

[![Spec Lint](https://img.shields.io/badge/spec--lint-required-blue)](.github/workflows/spec-lint.yml)
[![Schema Drift](https://img.shields.io/badge/schema--drift-required-blue)](.github/workflows/schema-drift.yml)
[![RAG](https://img.shields.io/badge/RAG-enabled-green)](agents/spec-generator/rag/)

---

## What this is

A complete, working reference implementation of an **AI-native analytics data lifecycle** — built end-to-end in GitHub.

A product manager writes a feature brief in plain English and commits it to the repo. From that moment on, a chain of AI agents and CI gates takes over:

1. The brief is read by an AI spec generator
2. The generator retrieves the 3 most similar past specs from a vector index (RAG) for consistency
3. It produces a fully-structured YAML tracking spec and opens a pull request
4. The spec is linted against repo-wide conventions and checked for schema drift before merge
5. After merge, three more AI agents fire in parallel:
   - Tracking concept documentation for engineers
   - Playwright dataLayer validation tests
   - GTM client-side container configuration
6. The vector index auto-updates with the new spec so the next generation is smarter

Nothing in this repo is a mockup. Everything runs in GitHub Actions, every artifact is committed to the repo, and the entire flow is reproducible by forking.

---

## Why this exists

Most analytics teams operate the same broken loop:

> PM has a question → analyst writes a tracking plan in a doc → engineer half-implements it → QA misses an edge case → bad data ships → analyst spots it in GA4 three weeks later → blame meeting → repeat.

The promise of AI agents is that this loop can be **inverted**: the human writes the *intent*, the machine writes the *implementation*, and CI guarantees the result matches the spec. The analyst's job moves from "tracking plan author" to "tracking system architect."

This repository is that idea built out in full. It targets the **Senior/Staff Web Analyst** role at Visable, but it stands on its own as a working blueprint for any data team transitioning to an AI-first model.

---

## What's inside

```
analytics-cicd/
├── .github/workflows/    ← 11 GitHub Actions workflows — the orchestration layer
├── agents/               ← 4 AI agents: spec, docs, tests, GTM
├── conventions/          ← The single source of truth for naming rules
├── data/                 ← The RAG vector index (auto-maintained)
├── feature-briefs/       ← Where PMs drop briefs (the only place humans write English)
├── gtm-assets/           ← Auto-generated GTM container exports
├── lib/                  ← Shared config-reader used by every script
├── playwright-datalayer-tests/   ← Auto-generated E2E tests
├── scripts/              ← Spec linter + artifact generator
├── specs/                ← Generated tracking specs (the contract)
├── tracking-concepts/    ← Auto-generated engineer-facing docs
├── pipeline.config.yaml  ← Pipeline-wide settings — change once, everything updates
└── schema-baseline.json  ← Current schema state, used for drift detection
```

Each folder has its own README explaining the files inside it. Start with the workflow tour in `.github/workflows/README.md` if you want to understand the orchestration. Start with `agents/README.md` if you want to understand the AI layer.

---

## How the pipeline flows

```
┌──────────────────┐
│  PM writes       │   feature-briefs/FB-006.md
│  feature brief   │   (committed via GitHub web UI — no Git client needed)
└────────┬─────────┘
         │ merge to main
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Generate Spec from Brief                                    │
│  • RAG: query data/spec-index.json for similar past specs    │
│  • Inject top 3 into Claude prompt                           │
│  • Claude generates YAML spec                                │
│  • Opens PR: auto-spec/FB-006                                │
└────────┬─────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────┐
│  PR gates (required status checks)                           │
│  • Spec Lint — validates against conventions.yaml            │
│  • Schema Drift Check — diffs against schema-baseline.json   │
│  → Analyst reviews and merges                                │
└────────┬─────────────────────────────────────────────────────┘
         │ merge to main
         ▼
┌──────────────────────────────────────────────────────────────┐
│  Parallel fan-out (4 workflows fire):                        │
│  • Index Specs for RAG   → updates data/spec-index.json      │
│  • Generate Tracking Concept for Devs → tracking-concepts/   │
│  • Generate Playwright dataLayer Test → playwright-datalayer-tests/ │
│  • Generate GTM Config   → gtm-assets/                       │
│  • Update Schema Baseline → schema-baseline.json             │
└──────────────────────────────────────────────────────────────┘
```

Every arrow above is a real, working GitHub Actions workflow. Every box produces a committed artifact. Nothing simulated.

---

## Setting up your own fork

Fork the repo. Then complete the four setup steps below in order.

### 1 — Required GitHub secrets

Set these under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Purpose | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Powers the spec, docs, tests, and GTM generator agents | [console.anthropic.com](https://console.anthropic.com) |
| `VOYAGE_API_KEY` | Powers the RAG embedding layer | [dash.voyageai.com](https://dash.voyageai.com) — free tier is sufficient |
| `WORKFLOW_PAT` | Fine-grained Personal Access Token. Required because `GITHUB_TOKEN` cannot trigger downstream workflows (anti-recursion safeguard). | See "Creating the WORKFLOW_PAT" below |

#### Creating the `WORKFLOW_PAT`

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**:

- Repository access: only your forked `analytics-cicd` repo
- Expiration: 1 year (set a calendar reminder)
- Required permissions:
  - **Contents**: Read and write
  - **Pull requests**: Read and write
  - **Workflows**: Read and write

Copy the generated token and save it as the `WORKFLOW_PAT` secret in the repo.

### 2 — Branch protection rules (ruleset)

Go to **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.

| Setting | Value |
|---|---|
| Ruleset name | `protect-main` |
| Enforcement status | Active |
| Target branches | Default branch (or explicitly `main`) |

Enable these rules:

- ✅ **Restrict deletions**
- ✅ **Require a pull request before merging** (uncheck "Require approvals" — you're solo)
- ✅ **Require status checks to pass**
  - Add required checks: `Validate tracking specs`, `Schema Drift Check`
- ✅ **Block force pushes**

Under **Bypass list**, add **your `WORKFLOW_PAT` actor** with bypass mode set to **Always**. This allows the artifact generator workflows to push directly to main (they each commit one auto-generated artifact per spec merge).

> **Why bypass and not full GitHub App?** A GitHub App with installation tokens is the architecturally cleaner option and is on the backlog. For a portfolio project the bypass-list approach is documented, auditable (commits show `github-actions[bot]` as author), and protected by `bot-path-guard.yml` which fails loudly if bot writes land outside expected paths.

### 3 — Initial RAG index bootstrap

The RAG index workflow (`index-specs.yml`) only fires on **new** spec merges. Your forked repo will already contain 5 specs from the original project — but the local `data/spec-index.json` was embedded with the original maintainer's Voyage account. Re-embed with your own key to be safe:

```bash
git clone https://github.com/<your-username>/analytics-cicd
cd analytics-cicd
cd agents/spec-generator && npm install && cd ../..

export VOYAGE_API_KEY="vk-..."
node agents/spec-generator/rag/index.js --force
```

This re-embeds every spec under your account. Commit the result to a PR.

```bash
git checkout -b chore/reindex-rag
git add data/spec-index.json
git commit -m "chore(rag): re-embed spec index under new Voyage account"
git push -u origin chore/reindex-rag
```

Open the PR and merge.

### 4 — First test run

The fastest end-to-end smoke test: create a new feature brief via the GitHub web UI.

1. Browse to `feature-briefs/` → **Add file → Create new file**
2. Name it `FB-006.md`
3. Drop in any plausible analytics request, for example:

```markdown
# FB-006 — Newsletter Signup Tracking

When a user successfully submits the newsletter signup form on the homepage,
we want to track the event in GA4 along with the signup source location
(header, footer, modal popup) and the user's locale.
```

4. Commit. Open the PR. Merge.

Watch the **Actions** tab. Within 90 seconds you should see:

- `Generate Spec from Brief` complete → opens PR `auto-spec/FB-006`
- That PR is gated by `Spec Lint` and `Schema Drift Check`
- After merging that second PR, four more workflows fire in parallel
- New files appear in `specs/`, `tracking-concepts/`, `playwright-datalayer-tests/`, `gtm-assets/`, and `data/spec-index.json`

If all of the above happened — you have a working AI-native analytics pipeline.

---

## What humans still do

This pipeline replaces manual *writing*, not manual *judgement*. Humans remain responsible for:

- **Reviewing every spec PR** — the AI is a junior analyst's first draft, not a final answer
- **Approving spec merges** — the moment of commitment to a tracking design
- **Updating `conventions/conventions.yaml`** — the only file the AI cannot edit because it *defines what the AI is allowed to do*
- **Resolving `NEEDS_CLARIFICATION`** placeholders the agent flags when a brief is ambiguous
- **Triggering Update Schema Baseline** when a breaking change is intentional

Everything else — drafting, scaffolding, doc writing, test writing, container config writing — is delegated to the agents.

---

## Tech stack

| Layer | Tools |
|---|---|
| Orchestration | GitHub Actions, GitHub Rulesets |
| AI generation | Claude (Sonnet 4) via Anthropic API |
| Vector embeddings | Voyage AI (`voyage-3-lite`, 512-dim) |
| Vector store | Plain JSON file (`data/spec-index.json`), in-process cosine similarity |
| Spec format | YAML with JSON Schema validation |
| Test framework | Playwright |
| Tag management | GTM client-side + server-side containers (sGTM via Cloud Run on roadmap) |
| Analytics platform | GA4 (primary), generic interface for others |
| Frontend reference | React + Nuxt 3 (project targets B2B marketplace use case) |

---

## What's on the roadmap

The following are implemented and live:

- ✅ Spec generator with RAG
- ✅ Spec linter + Schema drift detection (Anti-Corruption gates, soft block)
- ✅ Tracking concept doc generator
- ✅ Playwright dataLayer test generator (page-load events)
- ✅ GTM client-side container generator
- ✅ Two-PR governance flow (brief → spec → artifacts)
- ✅ Bot path guard (detection-not-prevention security model)

Planned next, in priority order:

- ⏳ **Hard-block release gates** — make Schema Drift Check a hard merge blocker, not just a comment
- ⏳ **MCP server wrapper** — expose pipeline actions as MCP tools so analysts can query the spec library directly from Claude Desktop or Cursor
- ⏳ **Live Truth monitoring** — scheduled synthetic Playwright + sGTM via Cloud Run + BigQuery; addresses sub-5-minute deploy-to-validation latency
- ⏳ **Mobile platform support** — extend specs with `platforms: [web, ios, android]` field; mobile test generator stub
- ⏳ **Playwright for interaction events** — current Playwright generator only handles page-load events; click/submit/hover events need a live inspector approach

See the per-folder READMEs for what's done within each subsystem.

---

## Key architectural decisions

A handful of choices that shaped this codebase, in case you're considering different ones in your own fork.

**Detection over prevention for bot writes.** Rather than tightly scoping bot permissions, the bot is allowed broad write access and `bot-path-guard.yml` fails loudly if it writes outside the expected paths. Simpler, auditable, easier to evolve.

**Smart-skip over path filters.** Required status checks with `paths:` filters create a deadlock — the check never reports status on PRs that don't touch matching files, blocking merge permanently. Solution: every required check runs on every PR but a runtime "Detect relevant changes" step short-circuits to success.

**Two-PR governance flow.** Briefs and specs are merged separately. A brief merge triggers spec generation; the generated spec arrives as its own PR for human review. This separates the *intent* PR (brief) from the *implementation* PR (spec).

**Plain JSON vector store.** No Pinecone, no Chroma, no Postgres. For a corpus of a few dozen YAML specs, a flat JSON file with in-process cosine similarity is correct and portable. The vector store *is* the file; it diffs cleanly in git.

**Single config file.** `pipeline.config.yaml` is the only place any pipeline setting lives. Every script and workflow imports from `lib/config-reader.js` — never hardcoded values.

For the full reasoning on any of the above, see the per-folder READMEs.

---

## Credits

Built by [Alireza Salem](https://github.com/alirezasalem).

Designed around the **Senior/Staff Web Analyst** role at [Visable](https://www.visable.com).

Powered by [Claude](https://www.anthropic.com/claude), [Voyage AI](https://www.voyageai.com), and [GitHub Actions](https://github.com/features/actions).

---

## License

MIT — fork it, learn from it, ship it.
