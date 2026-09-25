const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const projectRoutes = require('./src/routes/projectRoutes');

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors({
  origin: true, // Reflect request origin (extremely permissive for debugging)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '50mb' })); // Increase limit for SQL dumps

// Global request logger
app.use((req, res, next) => {
  console.log(`[Global] ${req.method} ${req.url}`);
  next();
});

app.use('/api/projects', projectRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GLOBAL ERROR HANDLER - Critical to prevent "Fake CORS" errors
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