import React, { useState } from 'react';
import FeedbackForm from './components/FeedbackForm';
import FeedbackList from './components/FeedbackList';
import './App.css';

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleFeedbackSubmit = () => {
    // Increment trigger to refresh feedback list
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="app" data-testid="app">
      <div className="app-container">
        <h1 className="app-title" data-testid="app-title">
          Feedback Form
        </h1>
        <p className="app-subtitle" data-testid="app-subtitle">
          Please share your feedback with us
        </p>
        <FeedbackForm onSuccess={handleFeedbackSubmit} />
        <FeedbackList refreshTrigger={refreshTrigger} />
      </div>
    </div>
  );
}

export default App;
