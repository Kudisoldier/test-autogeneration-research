const { STATUS_CODES } = require('./constants');

/**
 * Sends a success response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {Object} data - Response data
 */
const sendSuccess = (res, statusCode = STATUS_CODES.OK, data = {}) => {
  res.status(statusCode).json({
    success: true,
    ...data
  });
};

/**
 * Sends an error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} additionalData - Additional error data
 */
const sendError = (res, statusCode = STATUS_CODES.BAD_REQUEST, message, additionalData = {}) => {
  res.status(statusCode).json({
    success: false,
    error: message,
    ...additionalData
  });
};

module.exports = {
  sendSuccess,
  sendError
};
