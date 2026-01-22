/**
 * Formats a timestamp to a readable date string
 * @param {string} timestamp - ISO timestamp string
 * @returns {string} - Formatted date string
 */
export const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Generates star rating display string
 * @param {number} rating - Rating value (1-5)
 * @returns {string} - Star string (★ for filled, ☆ for empty)
 */
export const getRatingStars = (rating) => {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
};
