import { getDb } from './db.js';

const VALID_STATUSES = new Set(['received', 'acknowledged', 'shipped', 'rejected']);

const SEED_ORDERS = [
  {
    buyer: 'Acme Retail Corp',
    supplier: 'Northwind Supplies',
    status: 'received',
    lines: [
      { lineNo: 1, sku: 'WDG-100', description: 'Widget A', qty: 100, unitPrice: 12.5 },
      { lineNo: 2, sku: 'WDG-200', description: 'Widget B', qty: 50, unitPrice: 22.0 },
    ],
    internalCostCenter: 'CC-1001',
  },
  {
    buyer: 'Globex Manufacturing',
    supplier: 'Northwind Supplies',
    status: 'acknowledged',
    lines: [
      { lineNo: 1, sku: 'BRG-10', description: 'Bearing 10mm', qty: 500, unitPrice: 3.25 },
    ],
    internalCostCenter: 'CC-2002',
  },
  {
    buyer: 'Initech LLC',
    supplier: 'Contoso Parts',
    status: 'shipped',
    lines: [
      { lineNo: 1, sku: 'CAB-01', description: 'Cable Assembly', qty: 20, unitPrice: 45.0 },
      { lineNo: 2, sku: 'CON-05', description: 'Connector Pack', qty: 40, unitPrice: 8.75 },
    ],
    internalCostCenter: 'CC-3003',
  },
  {
    buyer: 'Umbrella Health',
    supplier: 'Contoso Parts',
    status: 'received',
    lines: [
      { lineNo: 1, sku: 'MSK-N95', description: 'N95 Mask Box', qty: 200, unitPrice: 15.0 },
    ],
    internalCostCenter: 'CC-4004',
  },
  {
    buyer: 'Stark Industries',
    supplier: 'Oscorp Materials',
    status: 'rejected',
    lines: [
      { lineNo: 1, sku: 'ALOY-1', description: 'Alloy Plate', qty: 10, unitPrice: 250.0 },
      { lineNo: 2, sku: 'BOLT-M8', description: 'M8 Bolts (100)', qty: 5, unitPrice: 18.5 },
    ],
    internalCostCenter: 'CC-5005',
  },
];

function stripId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

function lineTotal(lines) {
  return lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
}

export function isValidStatus(status) {
  return VALID_STATUSES.has(status);
}

export async function nextId(prefix, pad = 4) {
  const db = getDb();
  const result = await db.collection('counters').findOneAndUpdate(
    { _id: prefix },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = result.seq ?? result.value?.seq;
  return `${prefix}-${String(seq).padStart(pad, '0')}`;
}

export async function seedIfEmpty() {
  const db = getDb();
  const count = await db.collection('orders').countDocuments();
  if (count > 0) return { seeded: false, count };

  const now = new Date().toISOString();
  const orders = [];

  for (const seed of SEED_ORDERS) {
    const poNumber = await nextId('PO');
    orders.push({
      poNumber,
      buyer: seed.buyer,
      supplier: seed.supplier,
      status: seed.status,
      lines: seed.lines,
      total: lineTotal(seed.lines),
      createdAt: now,
      internalCostCenter: seed.internalCostCenter,
    });
  }

  await db.collection('orders').insertMany(orders);

  // Seed a shipment for the shipped PO
  const shipped = orders.find((o) => o.status === 'shipped');
  if (shipped) {
    const shipmentId = await nextId('SHP');
    await db.collection('shipments').insertOne({
      shipmentId,
      poNumber: shipped.poNumber,
      carrier: 'UPS',
      trackingNumber: '1Z999AA10123456784',
      shippedAt: now,
      lines: shipped.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty })),
    });
  }

  return { seeded: true, count: orders.length };
}

export async function resetAndSeed() {
  const db = getDb();
  await db.collection('orders').deleteMany({});
  await db.collection('shipments').deleteMany({});
  await db.collection('counters').deleteMany({});
  return seedIfEmpty();
}

export async function listOrders(status) {
  const db = getDb();
  const filter = status ? { status } : {};
  const docs = await db.collection('orders').find(filter).sort({ poNumber: 1 }).toArray();
  return docs.map(stripId);
}

export async function getOrder(poNumber) {
  const db = getDb();
  const doc = await db.collection('orders').findOne({ poNumber });
  return stripId(doc);
}

export function validateCreateOrder(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }
  if (!body.buyer || typeof body.buyer !== 'string' || !body.buyer.trim()) {
    return 'buyer is required';
  }
  if (!body.supplier || typeof body.supplier !== 'string' || !body.supplier.trim()) {
    return 'supplier is required';
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return 'lines must be a non-empty array';
  }
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line || typeof line !== 'object') {
      return `lines[${i}] must be an object`;
    }
    if (typeof line.lineNo !== 'number' || !Number.isInteger(line.lineNo) || line.lineNo < 1) {
      return `lines[${i}].lineNo must be a positive integer`;
    }
    if (!line.sku || typeof line.sku !== 'string') {
      return `lines[${i}].sku is required`;
    }
    if (line.description !== undefined && typeof line.description !== 'string') {
      return `lines[${i}].description must be a string`;
    }
    if (typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0) {
      return `lines[${i}].qty must be a positive number`;
    }
    if (typeof line.unitPrice !== 'number' || !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      return `lines[${i}].unitPrice must be a non-negative number`;
    }
  }
  return null;
}

export async function createOrder(body) {
  const db = getDb();
  const poNumber = await nextId('PO');
  const lines = body.lines.map((l) => ({
    lineNo: l.lineNo,
    sku: l.sku,
    description: l.description ?? '',
    qty: l.qty,
    unitPrice: l.unitPrice,
  }));
  const order = {
    poNumber,
    buyer: body.buyer.trim(),
    supplier: body.supplier.trim(),
    status: 'received',
    lines,
    total: lineTotal(lines),
    createdAt: new Date().toISOString(),
    internalCostCenter: body.internalCostCenter || 'CC-UNASSIGNED',
  };
  await db.collection('orders').insertOne(order);
  return stripId(order);
}

export async function acknowledgeOrder(poNumber) {
  const db = getDb();
  const order = await db.collection('orders').findOne({ poNumber });
  if (!order) return { error: 'PO_NOT_FOUND' };
  if (order.status !== 'received') return { error: 'INVALID_STATE', status: order.status };
  await db.collection('orders').updateOne({ poNumber }, { $set: { status: 'acknowledged' } });
  return { order: stripId({ ...order, status: 'acknowledged' }) };
}

export function validateShipment(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body must be a JSON object';
  }
  if (!body.carrier || typeof body.carrier !== 'string' || !body.carrier.trim()) {
    return 'carrier is required';
  }
  if (!body.trackingNumber || typeof body.trackingNumber !== 'string' || !body.trackingNumber.trim()) {
    return 'trackingNumber is required';
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return 'lines must be a non-empty array';
  }
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (typeof line.lineNo !== 'number' || !Number.isInteger(line.lineNo) || line.lineNo < 1) {
      return `lines[${i}].lineNo must be a positive integer`;
    }
    if (typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0) {
      return `lines[${i}].qty must be a positive number`;
    }
  }
  return null;
}

export async function createShipment(poNumber, body) {
  const db = getDb();
  const order = await db.collection('orders').findOne({ poNumber });
  if (!order) return { error: 'PO_NOT_FOUND' };
  if (order.status !== 'acknowledged') return { error: 'INVALID_STATE', status: order.status };

  const shipmentId = await nextId('SHP');
  const shipment = {
    shipmentId,
    poNumber,
    carrier: body.carrier.trim(),
    trackingNumber: body.trackingNumber.trim(),
    shippedAt: new Date().toISOString(),
    lines: body.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty })),
  };
  await db.collection('shipments').insertOne(shipment);
  await db.collection('orders').updateOne({ poNumber }, { $set: { status: 'shipped' } });
  return { shipment: stripId(shipment) };
}

export async function listShipments(poNumber) {
  const db = getDb();
  const order = await db.collection('orders').findOne({ poNumber });
  if (!order) return { error: 'PO_NOT_FOUND' };
  const docs = await db
    .collection('shipments')
    .find({ poNumber })
    .sort({ shipmentId: 1 })
    .toArray();
  return { shipments: docs.map(stripId) };
}
