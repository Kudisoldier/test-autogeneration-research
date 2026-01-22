/**
 * Initial form data structure
 */
export const INITIAL_FORM_DATA = {
  name: '',
  email: '',
  rating: '',
  message: ''
};

/**
 * Rating options for the select dropdown
 */
export const RATING_OPTIONS = [
  { value: '1', label: '1 - Poor' },
  { value: '2', label: '2 - Fair' },
  { value: '3', label: '3 - Good' },
  { value: '4', label: '4 - Very Good' },
  { value: '5', label: '5 - Excellent' }
];

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your connection and try again.',
  SUBMIT_FAILED: 'Failed to submit feedback. Please try again.',
  LOAD_FAILED: 'Failed to load feedbacks',
  LOAD_NETWORK_ERROR: 'Network error. Please try again later.'
};

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  FEEDBACK_SUBMITTED: 'Feedback submitted successfully!'
};
