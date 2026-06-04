require('dotenv').config();
require('express-async-errors');
const express = require('express');
// cors required removed
const helmet = require('helmet');
const morgan = require('morgan');
const notificationRoutes = require('./routes/notification.routes');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 5004;

app.use(helmet());
// CORS removed (handled by gateway)
app.use(morgan('dev'));
app.use(express.json());

app.use('/', notificationRoutes);

app.get('/health', (req, res) => res.json({ status: 'OK', service: 'notification-service' }));

app.use((err, req, res, next) => {
  console.error('Notification Service Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err.message }),
  });
});

app.listen(PORT, () => {
  console.log(`🔔 Notification Service running on port ${PORT}`);
  startScheduler();
});
