/**
 * In-memory storage for feedbacks
 * In production, this should be replaced with a database
 */
const feedbackStore = [];

/**
 * Adds a new feedback to storage
 * @param {Object} feedback - Feedback object to add
 * @returns {Object} - Added feedback object
 */
const addFeedback = (feedback) => {
  feedbackStore.push(feedback);
  return feedback;
};

/**
 * Gets all feedbacks from storage
 * @returns {Array} - Array of all feedbacks
 */
const getAllFeedbacks = () => {
  return [...feedbackStore]; // Return copy to prevent mutation
};

/**
 * Gets feedback count
 * @returns {number} - Number of feedbacks in storage
 */
const getFeedbackCount = () => {
  return feedbackStore.length;
};

/**
 * Creates a feedback object with generated ID and timestamp
 * @param {Object} data - Feedback data
 * @returns {Object} - Feedback object with ID and timestamp
 */
const createFeedback = (data) => {
  return {
    id: Date.now().toString(),
    name: data.name.trim(),
    email: data.email.trim(),
    rating: parseInt(data.rating),
    message: data.message.trim(),
    timestamp: new Date().toISOString()
  };
};

module.exports = {
  addFeedback,
  getAllFeedbacks,
  getFeedbackCount,
  createFeedback
};
