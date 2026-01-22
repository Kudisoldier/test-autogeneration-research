import React, { useState, useEffect } from 'react';
import { fetchFeedbacks, getLatestFeedbacks } from '../utils/api';
import { formatDate, getRatingStars } from '../utils/format';
import { ERROR_MESSAGES } from '../utils/constants';
import './FeedbackList.css';

const FeedbackList = ({ refreshTrigger }) => {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadFeedbacks = async () => {
    try {
      setLoading(true);
      setError(null);
      const allFeedbacks = await fetchFeedbacks();
      const latestFeedbacks = getLatestFeedbacks(allFeedbacks, 10);
      setFeedbacks(latestFeedbacks);
    } catch (err) {
      setError(err.message || ERROR_MESSAGES.LOAD_NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedbacks();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="feedback-list" data-testid="feedback-list">
        <h2 className="feedback-list-title" data-testid="feedback-list-title">
          Recent Feedback
        </h2>
        <div className="feedback-list-loading" data-testid="feedback-list-loading">
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feedback-list" data-testid="feedback-list">
        <h2 className="feedback-list-title" data-testid="feedback-list-title">
          Recent Feedback
        </h2>
        <div className="feedback-list-error" data-testid="feedback-list-error">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="feedback-list" data-testid="feedback-list">
      <h2 className="feedback-list-title" data-testid="feedback-list-title">
        Recent Feedback
      </h2>
      {feedbacks.length === 0 ? (
        <div className="feedback-list-empty" data-testid="feedback-list-empty">
          No feedback yet. Be the first to share your thoughts!
        </div>
      ) : (
        <div className="feedback-items" data-testid="feedback-items">
          {feedbacks.map((feedback) => (
            <div
              key={feedback.id}
              className="feedback-item"
              data-testid={`feedback-item-${feedback.id}`}
            >
              <div className="feedback-item-header">
                <div className="feedback-item-name" data-testid={`feedback-name-${feedback.id}`}>
                  {feedback.name}
                </div>
                <div className="feedback-item-date" data-testid={`feedback-date-${feedback.id}`}>
                  {formatDate(feedback.timestamp)}
                </div>
              </div>
              <div className="feedback-item-rating" data-testid={`feedback-rating-${feedback.id}`}>
                {getRatingStars(feedback.rating)}
                <span className="feedback-item-rating-value">({feedback.rating}/5)</span>
              </div>
              <div className="feedback-item-message" data-testid={`feedback-message-${feedback.id}`}>
                {feedback.message}
              </div>
              <div className="feedback-item-email" data-testid={`feedback-email-${feedback.id}`}>
                {feedback.email}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeedbackList;
