const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const projectRoutes = require('./src/routes/projectRoutes');

dotenv.config();

const app = express();
const prisma = new PrismaClient();

// 1. NUCLEAR CORS CONFIGURATION
// Put this at the absolute top before any other middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://client-henna-two-51.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000'
    ];

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // For debugging: allow all origins but log them
      console.log(`[CORS] Allowing origin: ${origin}`);
      callback(null, true);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200 // Some legacy browsers choke on 204
}));

// 2. Explicitly handle OPTIONS requests for all routes
app.options('*', cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Global request logger
app.use((req, res, next) => {
  console.log(`[Global] ${req.method} ${req.url}`);
  next();
});

app.use('/api/projects', projectRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]:', err.stack);
  res.status(err.status || 500).json({
    error: 'Internal Server Error',
    details: err.message
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SchemaGit server running on port ${PORT}`);
});