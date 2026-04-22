# CI/CD Overview

This project uses three GitHub Actions workflows with clear responsibility boundaries:

- `CI` (`.github/workflows/ci.yml`) - quality gate for code changes.
- `CD` (`.github/workflows/cd.yml`) - Docker image publish pipeline.
- `Generate Tests` (`.github/workflows/generate-tests.yml`) - manual test generation and evaluation pipeline for research.

## Why there are three workflows

Workflows are split by purpose:

- `CI` validates code health (tests/build) on regular development events.
- `CD` handles delivery (build and publish Docker image).
- `Generate Tests` is a separate, manual research flow (OpenRouter-based test generation + evaluation).

This separation keeps routine checks fast and stable, while generation/evaluation stays optional and isolated.

## Workflow details

### 1) CI workflow

- **File:** `.github/workflows/ci.yml`
- **Triggers:** `pull_request`, `push` to `main`/`master`
- **Job:** `test-and-build`

#### What the job does

1. Checks out repository.
2. Sets up Node.js 20 with npm cache.
3. Installs dependencies in root and `client`.
4. Runs tests via `npm run test` (server + client).
5. Builds frontend via `npm run build`.

#### Goal

Prevent regressions by ensuring the project installs, tests, and builds successfully before/after merge.

### 2) CD workflow

- **File:** `.github/workflows/cd.yml`
- **Triggers:** `push` to `main`/`master`, `workflow_dispatch`
- **Job:** `publish-docker`

#### What the job does

1. Checks out repository.
2. Logs in to GitHub Container Registry (`ghcr.io`).
3. Generates Docker tags/labels from branch/sha metadata.
4. Builds and pushes Docker image from `Dockerfile`.

#### Goal

Produce and publish a deployable container image to `ghcr.io/<owner>/<repo>`.

### 3) Generate Tests workflow

- **File:** `.github/workflows/generate-tests.yml`
- **Trigger:** `workflow_dispatch` (manual run with inputs)
- **Inputs:** `model`, `type`, `target`, `generate_all`, `output_dir`
- **Jobs:** `generate`, `evaluate`

#### Job: `generate`

1. Validates `OPENROUTER_API_KEY` secret.
2. Installs dependencies.
3. Generates tests for one target or all targets of a type.
4. Normalizes generated file/folder names for artifact compatibility (replaces forbidden characters like `:`).
5. Uploads generated tests as artifact.

#### Job: `evaluate` (depends on `generate`)

1. Downloads generated tests artifact.
2. Runs evaluation: `npm run evaluate:tests -- <output_dir>`.
3. Publishes concise metrics to GitHub Actions Job Summary.
4. Uploads `evaluation-report.json` as artifact.

#### Goal

Run a complete manual research cycle: generate tests with an LLM model, evaluate quality, and keep machine-readable artifacts.

## Docker usage in this project

Docker is used in two contexts:

1. **CD workflow (GitHub Actions):**
   - Builds/pushes production image from `Dockerfile`.
2. **Local development/testing:**
   - `docker-compose.yml` provides:
     - `app` service for running application.
     - `test-generator` service for test generation with OpenRouter.

`CI` workflow itself runs directly on GitHub runner with Node.js, without mandatory Docker usage.

## Job count clarification

- By **workflow count**: 3 workflows (`CI`, `CD`, `Generate Tests`).
- By **job count total**: 4 jobs:
  - `CI`: `test-and-build`
  - `CD`: `publish-docker`
  - `Generate Tests`: `generate`, `evaluate`
