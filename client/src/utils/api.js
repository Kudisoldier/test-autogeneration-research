const API_BASE_URL = '/api';

/**
 * Submits feedback to the server
 * @param {Object} formData - Feedback form data
 * @returns {Promise<Object>} - Response data
 */
export const submitFeedback = async (formData) => {
  const response = await fetch(`${API_BASE_URL}/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(formData)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to submit feedback');
  }

  return data;
};

/**
 * Fetches all feedbacks from the server
 * @returns {Promise<Array>} - Array of feedback objects
 */
export const fetchFeedbacks = async () => {
  const response = await fetch(`${API_BASE_URL}/feedback`);

  if (!response.ok) {
    throw new Error('Failed to load feedbacks');
  }

  const data = await response.json();
  return data.feedback || [];
};

/**
 * Gets the last N feedbacks sorted by timestamp (newest first)
 * @param {Array} feedbacks - Array of all feedbacks
 * @param {number} limit - Number of feedbacks to return (default: 10)
 * @returns {Array} - Sorted and limited feedbacks
 */
export const getLatestFeedbacks = (feedbacks, limit = 10) => {
  return feedbacks
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, limit);
};
