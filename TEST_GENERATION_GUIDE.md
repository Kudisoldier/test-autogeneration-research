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

## Notes

- The application uses in-memory storage (resets on server restart)
- All form fields are required
- Validation happens both client-side and server-side
- API responses follow a consistent structure with `success` boolean
- Use `clearFeedbacks()` from `server/utils/storage.js` in API tests to reset state
