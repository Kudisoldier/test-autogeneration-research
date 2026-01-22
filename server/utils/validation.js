/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if email is valid
 */
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates rating value
 * @param {any} rating - Rating value to validate
 * @returns {boolean} - True if rating is valid (1-5)
 */
const isValidRating = (rating) => {
  const ratingNum = parseInt(rating);
  return !isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5;
};

/**
 * Validates feedback data
 * @param {Object} data - Feedback data object
 * @returns {Object} - Validation result with isValid flag and errors
 */
const validateFeedback = (data) => {
  const { name, email, rating, message } = data;
  const errors = {};
  let isValid = true;

  // Check required fields
  if (!name || !name.trim()) {
    errors.name = 'Name is required';
    isValid = false;
  }

  if (!email || !email.trim()) {
    errors.email = 'Email is required';
    isValid = false;
  } else if (!isValidEmail(email)) {
    errors.email = 'Invalid email format';
    isValid = false;
  }

  if (!rating) {
    errors.rating = 'Rating is required';
    isValid = false;
  } else if (!isValidRating(rating)) {
    errors.rating = 'Rating must be a number between 1 and 5';
    isValid = false;
  }

  if (!message || !message.trim()) {
    errors.message = 'Message is required';
    isValid = false;
  }

  return { isValid, errors };
};

/**
 * Gets missing required fields
 * @param {Object} data - Feedback data object
 * @returns {Object} - Object with missing field flags
 */
const getMissingFields = (data) => {
  const { name, email, rating, message } = data;
  return {
    name: !name || !name.trim(),
    email: !email || !email.trim(),
    rating: !rating,
    message: !message || !message.trim()
  };
};

module.exports = {
  isValidEmail,
  isValidRating,
  validateFeedback,
  getMissingFields
};
