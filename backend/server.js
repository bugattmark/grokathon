import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import beefRouter from './routes/beef.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/beef', beefRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: process.env.TWEET_PROVIDER });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Tweet provider: ${process.env.TWEET_PROVIDER}`);
});
