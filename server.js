import { hostname } from 'node:os';
import dotenv from 'dotenv';
import express from 'express';
import { connectDb } from './src/db.js';
import { seedIfEmpty } from './src/data.js';
import { createRouter } from './src/routes.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'po_api';
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const GATEWAY_SHARED_SECRET = process.env.GATEWAY_SHARED_SECRET;
const INSTANCE = hostname();

if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI is required');
  process.exit(1);
}

function sensitiveHeaderNames(headers) {
  return Object.keys(headers).filter((name) => {
    const lower = name.toLowerCase();
    return (
      lower.startsWith('x-gateway-') ||
      lower.startsWith('x-forwarded-') ||
      lower === 'x-api-key'
    );
  });
}

async function main() {
  await connectDb(MONGODB_URI, MONGODB_DB);
  const seedResult = await seedIfEmpty();
  if (seedResult.seeded) {
    console.log(`Seeded ${seedResult.count} purchase orders`);
  } else {
    console.log(`Orders collection already has ${seedResult.count} document(s); skip seed`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.use((req, res, next) => {
    res.setHeader('X-Backend-Instance', INSTANCE);
    next();
  });

  if (GATEWAY_SHARED_SECRET) {
    app.use((req, res, next) => {
      const provided = req.headers['x-gateway-secret'];
      if (provided !== GATEWAY_SHARED_SECRET) {
        return res.status(403).json({
          error: { code: 'FORBIDDEN', message: 'Invalid or missing X-Gateway-Secret' },
        });
      }
      next();
    });
  }

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const names = sensitiveHeaderNames(req.headers);
      const namePart = names.length ? ` headers=[${names.join(',')}]` : '';
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms${namePart}`);
    });
    next();
  });

  app.use(createRouter());

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
  });

  app.listen(PORT, () => {
    console.log(`po-api listening on port ${PORT} (instance=${INSTANCE})`);
  });
}

main().catch((err) => {
  console.error('Failed to start po-api:', err);
  process.exit(1);
});
