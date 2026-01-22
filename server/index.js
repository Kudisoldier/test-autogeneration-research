const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Store feedback (in production, use a database)
const feedbackStore = [];

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Submit feedback endpoint
app.post('/api/feedback', (req, res) => {
  const { name, email, rating, message } = req.body;

  // Validation
  if (!name || !email || !rating || !message) {
    return res.status(400).json({
      error: 'All fields are required',
      missingFields: {
        name: !name,
        email: !email,
        rating: !rating,
        message: !message
      }
    });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      error: 'Invalid email format'
    });
  }

  // Rating validation
  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({
      error: 'Rating must be a number between 1 and 5'
    });
  }

  // Create feedback object
  const feedback = {
    id: Date.now().toString(),
    name: name.trim(),
    email: email.trim(),
    rating: ratingNum,
    message: message.trim(),
    timestamp: new Date().toISOString()
  };

  // Store feedback
  feedbackStore.push(feedback);

  // Return success response
  res.status(201).json({
    success: true,
    message: 'Feedback submitted successfully',
    feedback: feedback
  });
});

// Get all feedback (for testing purposes)
app.get('/api/feedback', (req, res) => {
  res.json({
    success: true,
    count: feedbackStore.length,
    feedback: feedbackStore
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
