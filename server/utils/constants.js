/**
 * Server configuration constants
 */
const SERVER_CONFIG = {
  PORT: process.env.PORT || 3001,
  DEFAULT_PORT: 3001
};

/**
 * HTTP status codes
 */
const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  INTERNAL_SERVER_ERROR: 500
};

/**
 * Error messages
 */
const ERROR_MESSAGES = {
  ALL_FIELDS_REQUIRED: 'All fields are required',
  INVALID_EMAIL: 'Invalid email format',
  INVALID_RATING: 'Rating must be a number between 1 and 5'
};

/**
 * Success messages
 */
const SUCCESS_MESSAGES = {
  FEEDBACK_SUBMITTED: 'Feedback submitted successfully'
};

module.exports = {
  SERVER_CONFIG,
  STATUS_CODES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES
};
