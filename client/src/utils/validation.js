/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if email is valid
 */
export const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validates a single form field
 * @param {string} name - Field name
 * @param {string} value - Field value
 * @returns {string} - Error message or empty string if valid
 */
export const validateField = (name, value) => {
  switch (name) {
    case 'name':
      if (!value.trim()) {
        return 'Name is required';
      }
      if (value.trim().length < 2) {
        return 'Name must be at least 2 characters';
      }
      return '';

    case 'email':
      if (!value.trim()) {
        return 'Email is required';
      }
      if (!isValidEmail(value)) {
        return 'Please enter a valid email address';
      }
      return '';

    case 'rating':
      if (!value) {
        return 'Rating is required';
      }
      const ratingNum = parseInt(value);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return 'Rating must be between 1 and 5';
      }
      return '';

    case 'message':
      if (!value.trim()) {
        return 'Message is required';
      }
      if (value.trim().length < 10) {
        return 'Message must be at least 10 characters';
      }
      return '';

    default:
      return '';
  }
};

/**
 * Validates entire form
 * @param {Object} formData - Form data object
 * @returns {Object} - Object with errors for each field
 */
export const validateForm = (formData) => {
  const errors = {};

  Object.keys(formData).forEach(key => {
    const error = validateField(key, formData[key]);
    if (error) {
      errors[key] = error;
    }
  });

  return errors;
};
