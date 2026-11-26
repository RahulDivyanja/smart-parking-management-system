const express = require('express');

const app = express();

app.use(express.json());

// Basic health check endpoint placeholder
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'parkease-notification-service',
    status: 'UP',
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
