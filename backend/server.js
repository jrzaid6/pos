const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// API clients expect JSON response bodies; conditional 304 responses were being
// treated as failures by Axios and could leave Settings sections blank.
app.set('etag', false);
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Security Middleware
app.use(helmet()); // Set secure HTTP headers
app.use(morgan('combined')); // Log HTTP requests

// Rate Limiting (General: 100 requests per 15 minutes)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 1000, // increased general limit
  standardHeaders: true, 
  legacyHeaders: false,
});
// Apply limiter to all requests
app.use(limiter);

// Specific stricter limit for Auth routes (Login)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 500, // increased auth limit
  message: 'Too many login attempts, please try again after 15 minutes'
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' })); // Limit JSON body size

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/credits', require('./routes/credits'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/bank-cash', require('./routes/bankCash'));

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 5001;

const startServer = async () => {
    try {
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
