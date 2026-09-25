const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const projectRoutes = require('./src/routes/projectRoutes');

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.use(cors({
  origin: ['https://client-henna-two-51.vercel.app', 'http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Global request logger
app.use((req, res, next) => {
  console.log(`[Global] ${req.method} ${req.url}`);
  next();
});

app.use('/api/projects', projectRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SchemaGit server running on port ${PORT}`);
});