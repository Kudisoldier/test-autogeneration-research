import React, { useState } from 'react';
import './FeedbackForm.css';

const FeedbackForm = ({ onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    rating: '',
    message: ''
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const validateField = (name, value) => {
    let error = '';

    switch (name) {
      case 'name':
        if (!value.trim()) {
          error = 'Name is required';
        } else if (value.trim().length < 2) {
          error = 'Name must be at least 2 characters';
        }
        break;
      case 'email':
        if (!value.trim()) {
          error = 'Email is required';
        } else {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            error = 'Please enter a valid email address';
          }
        }
        break;
      case 'rating':
        if (!value) {
          error = 'Rating is required';
        } else {
          const ratingNum = parseInt(value);
          if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            error = 'Rating must be between 1 and 5';
          }
        }
        break;
      case 'message':
        if (!value.trim()) {
          error = 'Message is required';
        } else if (value.trim().length < 10) {
          error = 'Message must be at least 10 characters';
        }
        break;
      default:
        break;
    }

    return error;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }

    // Clear submit status when user makes changes
    if (submitStatus) {
      setSubmitStatus(null);
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    const error = validateField(name, value);
    setErrors(prev => ({
      ...prev,
      [name]: error
    }));
  };

  const validateForm = () => {
    const newErrors = {};
    let isValid = true;

    Object.keys(formData).forEach(key => {
      const error = validateField(key, formData[key]);
      if (error) {
        newErrors[key] = error;
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitStatus(null);

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitStatus({ type: 'success', message: data.message || 'Feedback submitted successfully!' });
        setFormData({
          name: '',
          email: '',
          rating: '',
          message: ''
        });
        setErrors({});
        // Trigger refresh of feedback list
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setSubmitStatus({ type: 'error', message: data.error || 'Failed to submit feedback. Please try again.' });
      }
    } catch (error) {
      setSubmitStatus({ type: 'error', message: 'Network error. Please check your connection and try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form 
      className="feedback-form" 
      onSubmit={handleSubmit}
      data-testid="feedback-form"
      noValidate
    >
      <div className="form-group" data-testid="form-group-name">
        <label htmlFor="name" className="form-label" data-testid="label-name">
          Name <span className="required">*</span>
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={formData.name}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`form-input ${errors.name ? 'form-input-error' : ''}`}
          data-testid="input-name"
          aria-label="Name"
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'error-name' : undefined}
        />
        {errors.name && (
          <span 
            className="error-message" 
            id="error-name"
            data-testid="error-name"
            role="alert"
          >
            {errors.name}
          </span>
        )}
      </div>

      <div className="form-group" data-testid="form-group-email">
        <label htmlFor="email" className="form-label" data-testid="label-email">
          Email <span className="required">*</span>
        </label>
        <input
          type="email"
          id="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`form-input ${errors.email ? 'form-input-error' : ''}`}
          data-testid="input-email"
          aria-label="Email"
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'error-email' : undefined}
        />
        {errors.email && (
          <span 
            className="error-message" 
            id="error-email"
            data-testid="error-email"
            role="alert"
          >
            {errors.email}
          </span>
        )}
      </div>

      <div className="form-group" data-testid="form-group-rating">
        <label htmlFor="rating" className="form-label" data-testid="label-rating">
          Rating <span className="required">*</span>
        </label>
        <select
          id="rating"
          name="rating"
          value={formData.rating}
          onChange={handleChange}
          onBlur={handleBlur}
          className={`form-select ${errors.rating ? 'form-select-error' : ''}`}
          data-testid="select-rating"
          aria-label="Rating"
          aria-required="true"
          aria-invalid={!!errors.rating}
          aria-describedby={errors.rating ? 'error-rating' : undefined}
        >
          <option value="">Select a rating</option>
          <option value="1" data-testid="rating-option-1">1 - Poor</option>
          <option value="2" data-testid="rating-option-2">2 - Fair</option>
          <option value="3" data-testid="rating-option-3">3 - Good</option>
          <option value="4" data-testid="rating-option-4">4 - Very Good</option>
          <option value="5" data-testid="rating-option-5">5 - Excellent</option>
        </select>
        {errors.rating && (
          <span 
            className="error-message" 
            id="error-rating"
            data-testid="error-rating"
            role="alert"
          >
            {errors.rating}
          </span>
        )}
      </div>

      <div className="form-group" data-testid="form-group-message">
        <label htmlFor="message" className="form-label" data-testid="label-message">
          Message <span className="required">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          value={formData.message}
          onChange={handleChange}
          onBlur={handleBlur}
          rows="5"
          className={`form-textarea ${errors.message ? 'form-textarea-error' : ''}`}
          data-testid="textarea-message"
          aria-label="Message"
          aria-required="true"
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? 'error-message' : undefined}
        />
        {errors.message && (
          <span 
            className="error-message" 
            id="error-message"
            data-testid="error-message"
            role="alert"
          >
            {errors.message}
          </span>
        )}
      </div>

      {submitStatus && (
        <div 
          className={`submit-status submit-status-${submitStatus.type}`}
          data-testid={`submit-status-${submitStatus.type}`}
          role="alert"
        >
          {submitStatus.message}
        </div>
      )}

      <button
        type="submit"
        className="submit-button"
        disabled={isSubmitting}
        data-testid="submit-button"
        aria-label="Submit feedback"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
      </button>
    </form>
  );
};

export default FeedbackForm;
