require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/api');

const app = express();
const port = process.env.PORT || 3000;

// Middleware - CORS ayarları geliştirildi
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(express.json());

// Request logging middleware (debug için)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/', (req, res) => {
    res.send('Edebi Analiz Platformu Backend Çalışıyor...');
});

app.listen(port, () => {
    console.log(`Backend http://localhost:${port} adresinde çalışıyor`);
});