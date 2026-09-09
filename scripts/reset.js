import dotenv from 'dotenv';
import { connectDb, closeDb } from '../src/db.js';
import { resetAndSeed } from '../src/data.js';

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'po_api';

if (!uri) {
  console.error('FATAL: MONGODB_URI is required');
  process.exit(1);
}

try {
  await connectDb(uri, dbName);
  const result = await resetAndSeed();
  console.log(`Reset complete. Seeded ${result.count} purchase orders.`);
  await closeDb();
  process.exit(0);
} catch (err) {
  console.error('Reset failed:', err);
  process.exit(1);
}
