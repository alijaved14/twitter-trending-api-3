import express from 'express';
import cors from 'cors';
import { config } from './config';
import { TweetStream } from './stream';
import { createRouter } from './routes';

async function main() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const stream = new TweetStream();
  app.use('/api', createRouter(stream));

  app.get('/', (_req, res) => {
    res.json({
      name: 'twitter-trending-api',
      version: '1.0.0',
      endpoints: {
        tweets: 'GET /api/tweets?limit=50',
        stream: 'GET /api/stream  (SSE)',
        health: 'GET /api/health',
      },
    });
  });

  app.listen(config.port, () => {
    console.log(`[Server] Listening on http://localhost:${config.port}`);
  });

  // Start the continuous polling loop
  await stream.start();
}

main().catch((err) => {
  console.error('[Fatal]', err);
  process.exit(1);
});
