const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { validateFeedback, getMissingFields } = require('./utils/validation');
const { createFeedback, addFeedback, getAllFeedbacks, getFeedbackCount } = require('./utils/storage');
const { sendSuccess, sendError } = require('./utils/responses');
const { SERVER_CONFIG, STATUS_CODES, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('./utils/constants');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  sendSuccess(res, STATUS_CODES.OK, { status: 'ok' });
});

// Submit feedback endpoint
app.post('/api/feedback', (req, res) => {
  const validation = validateFeedback(req.body);

  if (!validation.isValid) {
    const missingFields = getMissingFields(req.body);
    const hasMissingFields = Object.values(missingFields).some(field => field);
    const errorMessage = hasMissingFields 
      ? ERROR_MESSAGES.ALL_FIELDS_REQUIRED 
      : Object.values(validation.errors)[0] || 'Validation failed';
    
    return sendError(
      res,
      STATUS_CODES.BAD_REQUEST,
      errorMessage,
      { missingFields, errors: validation.errors }
    );
  }

  try {
    const feedback = createFeedback(req.body);
    addFeedback(feedback);

    sendSuccess(res, STATUS_CODES.CREATED, {
      message: SUCCESS_MESSAGES.FEEDBACK_SUBMITTED,
      feedback
    });
  } catch (error) {
    sendError(res, STATUS_CODES.INTERNAL_SERVER_ERROR, 'Internal server error');
  }
});

// Get all feedback endpoint
app.get('/api/feedback', (req, res) => {
  try {
    const feedbacks = getAllFeedbacks();
    sendSuccess(res, STATUS_CODES.OK, {
      count: getFeedbackCount(),
      feedback: feedbacks
    });
  } catch (error) {
    sendError(res, STATUS_CODES.INTERNAL_SERVER_ERROR, 'Failed to retrieve feedbacks');
  }
});

app.listen(SERVER_CONFIG.PORT, () => {
  console.log(`Server is running on port ${SERVER_CONFIG.PORT}`);
});
