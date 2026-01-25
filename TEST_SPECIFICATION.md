# Test Specification for Feedback Form Application

## Overview

This document describes the test scenarios and requirements for the Feedback Form application, designed for research on autogeneration of autotests for web applications.

**Note**: This is a base application for research. No tests are pre-written. The goal is to compare different LLMs and approaches for generating autotests based on this specification.

## Application Structure

### Frontend Components
- **App.jsx**: Main application component
- **FeedbackForm.jsx**: Form for submitting feedback
- **FeedbackList.jsx**: List displaying submitted feedbacks

### Backend API
- **POST /api/feedback**: Submit feedback
- **GET /api/feedback**: Retrieve all feedbacks
- **GET /api/health**: Health check endpoint

## Test Categories

### 1. Unit Tests

#### Frontend Unit Tests

**FeedbackForm Component**
- Renders all form fields (name, email, rating, message)
- Shows validation errors for empty required fields
- Validates email format
- Validates name minimum length (2 characters)
- Validates message minimum length (10 characters)
- Validates rating range (1-5)
- Submits form with valid data
- Shows success message after successful submission
- Shows error message on submission failure
- Disables submit button while submitting
- Clears form after successful submission
- Clears errors when user starts typing

**FeedbackList Component**
- Shows loading state initially
- Displays feedback items when loaded
- Shows empty state when no feedbacks
- Shows error message on fetch failure
- Refreshes when refreshTrigger changes

**Validation Utilities**
- Email validation (valid/invalid formats)
- Field validation (name, email, rating, message)
- Form validation (complete form)

#### Backend Unit Tests

**Validation Utilities**
- Email format validation
- Rating range validation (1-5)
- Complete feedback validation
- Missing fields detection

**Storage Utilities**
- Add feedback to storage
- Retrieve all feedbacks
- Get feedback count
- Create feedback with ID and timestamp

### 2. Integration Tests

**API Endpoints**
- Health check endpoint returns status
- POST /api/feedback creates feedback with valid data
- POST /api/feedback returns 400 for missing fields
- POST /api/feedback returns 400 for invalid email
- POST /api/feedback returns 400 for invalid rating
- GET /api/feedback returns empty array when no feedbacks
- GET /api/feedback returns all feedbacks

### 3. End-to-End Tests

**User Flows**
- Display feedback form on page load
- Show validation errors for empty form submission
- Validate email format in real-time
- Submit valid feedback successfully
- Display submitted feedback in the list
- Show loading state when fetching feedbacks
- Handle form field interactions
- Clear errors when user starts typing

## Test Data Attributes

All interactive elements have `data-testid` attributes for reliable test targeting:

### Form Elements
- `feedback-form`: Main form container
- `input-name`: Name input field
- `input-email`: Email input field
- `select-rating`: Rating select dropdown
- `textarea-message`: Message textarea
- `submit-button`: Submit button
- `error-name`, `error-email`, `error-rating`, `error-message`: Error messages
- `submit-status-success`, `submit-status-error`: Status messages

### List Elements
- `feedback-list`: Feedback list container
- `feedback-list-loading`: Loading state
- `feedback-list-error`: Error state
- `feedback-list-empty`: Empty state
- `feedback-item-{id}`: Individual feedback item
- `feedback-name-{id}`: Feedback name
- `feedback-email-{id}`: Feedback email
- `feedback-rating-{id}`: Feedback rating
- `feedback-message-{id}`: Feedback message

## Test Scenarios for Autogeneration Research

### Scenario 1: Form Validation
**Input**: User attempts to submit empty form
**Expected**: All required field errors displayed
**Test Type**: E2E, Unit

### Scenario 2: Email Validation
**Input**: User enters invalid email format
**Expected**: Email validation error displayed
**Test Type**: E2E, Unit

### Scenario 3: Successful Submission
**Input**: User fills all fields correctly and submits
**Expected**: Success message, form cleared, feedback appears in list
**Test Type**: E2E, Integration

### Scenario 4: API Error Handling
**Input**: Network error during submission
**Expected**: Error message displayed to user
**Test Type**: E2E, Unit

### Scenario 5: Data Display
**Input**: Feedback submitted successfully
**Expected**: Feedback appears in list with correct data
**Test Type**: E2E, Integration

## Test Coverage Goals

- **Unit Tests**: >80% code coverage
- **Integration Tests**: All API endpoints covered
- **E2E Tests**: All critical user flows covered

## Test Tools

- **Unit Tests**: Jest + React Testing Library
- **Integration Tests**: Jest + Supertest
- **E2E Tests**: Playwright
- **Coverage**: Jest coverage reports

## Notes for Test Generation Research

1. All components use semantic HTML and ARIA attributes
2. All interactive elements have `data-testid` attributes
3. Form validation is implemented both client-side and server-side
4. Error states are clearly defined and testable
5. Loading states are implemented and testable
6. API responses follow consistent structure

## Test Execution

```bash
# Run all tests
npm run test:all

# Run unit tests only
npm run test

# Run E2E tests only
npm run test:e2e

# Run with coverage
npm run test:coverage
```
