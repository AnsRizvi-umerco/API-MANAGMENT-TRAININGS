import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectDb(uri, dbName) {
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not connected');
  }
  return db;
}

export async function pingDb() {
  await getDb().command({ ping: 1 });
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = undefined;
    db = undefined;
  }
}
