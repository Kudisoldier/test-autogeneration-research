import React, { useState } from 'react';
import { validateField, validateForm as validateFormData } from '../utils/validation';
import { submitFeedback } from '../utils/api';
import { INITIAL_FORM_DATA, RATING_OPTIONS, ERROR_MESSAGES, SUCCESS_MESSAGES } from '../utils/constants';
import './FeedbackForm.css';

const FeedbackForm = ({ onSuccess }) => {
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitStatus(null);

    const formErrors = validateFormData(formData);
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      return;
    }

    setIsSubmitting(true);

    try {
      const data = await submitFeedback(formData);
      setSubmitStatus({ 
        type: 'success', 
        message: data.message || SUCCESS_MESSAGES.FEEDBACK_SUBMITTED 
      });
      setFormData(INITIAL_FORM_DATA);
      setErrors({});
      
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      setSubmitStatus({ 
        type: 'error', 
        message: error.message || ERROR_MESSAGES.SUBMIT_FAILED 
      });
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
          {RATING_OPTIONS.map((option) => (
            <option 
              key={option.value} 
              value={option.value}
              data-testid={`rating-option-${option.value}`}
            >
              {option.label}
            </option>
          ))}
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
