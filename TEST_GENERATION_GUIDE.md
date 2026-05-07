# Test Generation Guide for Research

## Purpose

This document provides guidance for generating tests for the Feedback Form application as part of research comparing different LLMs and approaches for autotest generation.

## Test Infrastructure

The following testing infrastructure is already configured:

### Frontend Testing
- **Jest** + **React Testing Library** for unit/integration tests
- **Playwright** for E2E tests
- Configuration files: `client/jest.config.js`, `client/playwright.config.js`
- Setup file: `client/src/setupTests.js`

### Backend Testing
- **Jest** + **Supertest** for API tests
- Configuration file: `jest.config.js` (root)

### Test Directories Structure

```
client/
  src/
    components/
      __tests__/          # Component unit tests
    utils/
      __tests__/          # Utility function tests
  tests/
    e2e/                  # Playwright E2E tests

server/
  __tests__/              # API integration tests
  utils/
    __tests__/            # Utility function tests
```

## Test Generation Targets

### 1. Frontend Component Tests

**Location**: `client/src/components/__tests__/`

**Files to generate**:
- `FeedbackForm.test.jsx` - Test the feedback form component
- `FeedbackList.test.jsx` - Test the feedback list component

**Key test scenarios** (see `TEST_SPECIFICATION.md` for details):
- Form rendering
- Validation logic
- User interactions
- Error handling
- Success states

### 2. Frontend Utility Tests

**Location**: `client/src/utils/__tests__/`

**Files to generate**:
- `validation.test.js` - Test validation utilities
- `api.test.js` - Test API utilities (optional, can be integration tested)
- `format.test.js` - Test formatting utilities (if applicable)

### 3. Backend Unit Tests

**Location**: `server/utils/__tests__/`

**Files to generate**:
- `validation.test.js` - Test server-side validation
- `storage.test.js` - Test storage utilities (optional)

### 4. Backend Integration Tests

**Location**: `server/__tests__/`

**Files to generate**:
- `api.test.js` - Test API endpoints using Supertest

**Key test scenarios**:
- POST /api/feedback with valid data
- POST /api/feedback with invalid data
- GET /api/feedback
- GET /api/health

### 5. E2E Tests

**Location**: `client/tests/e2e/`

**Files to generate**:
- `feedback-form.spec.js` - End-to-end user flow tests

**Key test scenarios**:
- Complete form submission flow
- Validation error display
- Feedback list display
- Error handling

## Test Data Attributes

All interactive elements have `data-testid` attributes for reliable test targeting. Use these in your generated tests:

### Form Elements
- `data-testid="feedback-form"` - Main form
- `data-testid="input-name"` - Name input
- `data-testid="input-email"` - Email input
- `data-testid="select-rating"` - Rating select
- `data-testid="textarea-message"` - Message textarea
- `data-testid="submit-button"` - Submit button
- `data-testid="error-name"`, `data-testid="error-email"`, etc. - Error messages
- `data-testid="submit-status-success"` - Success message
- `data-testid="submit-status-error"` - Error message

### List Elements
- `data-testid="feedback-list"` - List container
- `data-testid="feedback-item-{id}"` - Individual feedback item
- `data-testid="feedback-name-{id}"` - Feedback name
- `data-testid="feedback-email-{id}"` - Feedback email
- `data-testid="feedback-rating-{id}"` - Feedback rating
- `data-testid="feedback-message-{id}"` - Feedback message

## Code Structure Reference

### Frontend Components

**FeedbackForm.jsx** (`client/src/components/FeedbackForm.jsx`):
- Uses React hooks (useState)
- Form validation on blur and submit
- API call via `submitFeedback` from `utils/api.js`
- Error and success state management

**FeedbackList.jsx** (`client/src/components/FeedbackList.jsx`):
- Fetches data on mount and when `refreshTrigger` changes
- Loading, error, and empty states
- Displays feedback items with formatting

### Backend API

**Endpoints** (`server/index.js`):
- `GET /api/health` - Returns `{ success: true, status: 'ok' }`
- `POST /api/feedback` - Accepts `{ name, email, rating, message }`
  - Returns `{ success: true, message, feedback }` on success
  - Returns `{ success: false, error, missingFields, errors }` on error
- `GET /api/feedback` - Returns `{ success: true, count, feedback: [...] }`

### Validation Rules

**Client-side** (`client/src/utils/validation.js`):
- Name: required, min 2 characters
- Email: required, valid email format
- Rating: required, 1-5
- Message: required, min 10 characters

**Server-side** (`server/utils/validation.js`):
- Name: required, non-empty
- Email: required, valid email format
- Rating: required, 1-5
- Message: required, non-empty

## Running Generated Tests

After generating tests, run them with:

```bash
# All tests
npm run test:all

# Server tests only
npm run test:server

# Client tests only
npm run test:client

# E2E tests only
npm run test:e2e

# With coverage
cd client && npm run test:coverage
```

## Evaluation Criteria

When comparing different LLM-generated tests, consider:

1. **Coverage**: Do tests cover all specified scenarios?
2. **Correctness**: Do tests correctly validate expected behavior?
3. **Maintainability**: Are tests well-structured and readable?
4. **Completeness**: Are edge cases and error scenarios covered?
5. **Best Practices**: Do tests follow testing best practices?
6. **Execution**: Do all tests pass?

## Three-stage pipeline (planner → generator → verify)

Structured generation uses a **context manifest** (`specs/pipeline/context-manifest.schema.json`) with a required **`generation`** block (preset, planner/generator `temperature` / `top_p` / `max_tokens`, `selector_policy`, `emit_plan_markdown`, `require_plan_case_comments`), a machine-readable **plan** (`specs/pipeline/test-plan.schema.json`), optional **`test_plan.md`**, and example manifests under [`specs/pipeline/examples/`](specs/pipeline/examples/).

**Module syntax (generator + verify):** `unit_server` / `integration_server` must use **CommonJS** (`require` / `module.exports`) because root Jest runs server tests without Babel. `unit_ui`, `integration_ui`, and `e2e` should use **ESM** (`import` / `export`) — client tests use babel-jest; e2e uses Playwright. Verify rejects top-level `import` / `export` lines in generated files under `generated/server/**/*.js` (glob `server/**/*.js` relative to `generated/`).

| Legacy `generate-tests.js --type` | `test_level` in manifest |
|-----------------------------------|---------------------------|
| `unit` (client components/utils)  | `unit_ui` or `unit_server` (server modules use `unit_server`) |
| `integration` (API)               | `integration_server` |
| (not previously split)            | `integration_ui` — OpenAPI + only components/hooks that call listed `operation_ids` |
| `e2e`                             | `e2e` — planner/generator use `requirements` + `page_snapshot` |

**Commands** (require `OPENROUTER_API_KEY` for LLM stages):

```bash
npm run pipeline:plan -- --manifest specs/pipeline/examples/unit_ui.manifest.json --model <openrouter_model_id> \
  [--preset strict|balanced|exploratory] [--planner-temperature <n>] [--planner-top-p <n>] [--planner-max-tokens <n>] \
  [--no-json-mode] [--selector-policy auto|data-testid|role-first|none] [--no-plan-markdown] [--no-plan-case-comments]

npm run pipeline:generate -- --run-dir research-output/runs/<id> --model <openrouter_model_id> \
  [--preset strict|balanced|exploratory] [--generator-temperature <n>] [--generator-top-p <n>] [--generator-max-tokens <n>] \
  [--selector-policy <p>] [--no-plan-case-comments]

npm run pipeline:verify -- --run-dir research-output/runs/<id> [--run-tests]
npm run pipeline:all -- --manifest specs/pipeline/examples/unit_ui.manifest.json --model <openrouter_model_id> \
  [--preset <name>] [--planner-temperature <n>] [--generator-temperature <n>] [--no-json-mode] [--run-tests]
```

CLI overrides win over values in the manifest `generation` block; presets live in `scripts/pipeline/presets.json`.

Artifacts per run directory: `context_manifest.json`, `test_plan.json`, optional `test_plan.md`, `plan.meta.json` (includes `resolved_generation` and OpenAPI subset meta when applicable), `generate.meta.json`, `generated/<repo-relative-path>`, `verify.log`. Verify runs **`node --check`** only on paths where Node can parse the file (not **`client/**/*.js`** or **`.jsx`**, where ESM/JSX is validated by Jest when `--run-tests` is used). Verify also checks **plan-case coverage** (`// plan-case: <id>` for every plan case when `require_plan_case_comments` is true), rejects unknown plan-case ids, and enforces **no ESM in server** paths (see `scripts/pipeline/verify-rules.json`). Exit code **2** = manifest/plan validation; **3** = verify (syntax, forbidden patterns, plan-case checks, or server ESM guard).

**`--run-tests` and `evaluation-report.json`:** With `pipeline:verify --run-tests` (or `pipeline:all ... --run-tests`), verify stages generated files into the repo, runs Jest with `--json`, and writes **`evaluation-report.json`** in the run directory (same shape as `scripts/evaluate-tests.js`: `summary`, `byModel`, `byModelType`, `byType`, `details`). **Model** comes from `generate.meta.json` (fallback `plan.meta.json`). **Type** bucket is derived from `context_manifest.json` → `test_level`: `unit_*` → `unit`, `integration_*` → `integration`, `e2e` → `e2e`. **Per-file `ttgSeconds`** in `details` is `plan.meta.json` `seconds` + `generate.meta.json` `seconds` (wall time for plan + generate for that run). Jest **assertion failures** are reflected in the report (`passes`, `failCount`) but **do not** change verify’s exit code; verify still exits **3** only on syntax/forbidden/plan-case failures or staging I/O errors. **E2E:** `test_level: e2e` is not executed in verify (`runs: false` in details, message in `errorOutput`); use Playwright separately. For legacy layouts under `research-output/<model>/<type>/...`, continue using `node scripts/evaluate-tests.js [dir]`.

The legacy script `npm run generate:test` remains a single-shot path until deprecated.

## Notes

- The application uses in-memory storage (resets on server restart)
- All form fields are required
- Validation happens both client-side and server-side
- API responses follow a consistent structure with `success` boolean
- Use `clearFeedbacks()` from `server/utils/storage.js` in API tests to reset state
