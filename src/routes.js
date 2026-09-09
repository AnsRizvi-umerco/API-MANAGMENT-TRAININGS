import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import yaml from 'js-yaml';
import { pingDb } from './db.js';
import {
  acknowledgeOrder,
  createOrder,
  createShipment,
  getOrder,
  isValidStatus,
  listOrders,
  listShipments,
  validateCreateOrder,
  validateShipment,
} from './data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapiPath = join(__dirname, '..', 'openapi.yaml');

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

export function createRouter() {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await pingDb();
      res.status(200).json({ status: 'ok', db: 'ok' });
    } catch {
      sendError(res, 503, 'DB_UNAVAILABLE', 'MongoDB Atlas unreachable');
    }
  });

  router.get('/echo', (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp =
      (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
      req.socket.remoteAddress ||
      null;
    res.status(200).json({
      method: req.method,
      path: req.path,
      query: req.query,
      clientIp,
      headers: req.headers,
    });
  });

  router.get('/orders', async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && status !== '') {
      if (typeof status !== 'string' || !isValidStatus(status)) {
        return sendError(
          res,
          400,
          'INVALID_STATUS',
          'status must be one of: received, acknowledged, shipped, rejected'
        );
      }
    }
    const orders = await listOrders(status || undefined);
    res.status(200).json({ orders });
  });

  router.get('/orders/:poNumber', async (req, res) => {
    const order = await getOrder(req.params.poNumber);
    if (!order) {
      return sendError(res, 404, 'PO_NOT_FOUND', `Purchase order ${req.params.poNumber} not found`);
    }
    res.status(200).json(order);
  });

  router.post('/orders', async (req, res) => {
    const err = validateCreateOrder(req.body);
    if (err) {
      return sendError(res, 400, 'VALIDATION_ERROR', err);
    }
    const order = await createOrder(req.body);
    res.status(201).json(order);
  });

  router.post('/orders/:poNumber/acknowledge', async (req, res) => {
    const result = await acknowledgeOrder(req.params.poNumber);
    if (result.error === 'PO_NOT_FOUND') {
      return sendError(res, 404, 'PO_NOT_FOUND', `Purchase order ${req.params.poNumber} not found`);
    }
    if (result.error === 'INVALID_STATE') {
      return sendError(
        res,
        409,
        'INVALID_STATE',
        `Cannot acknowledge order in status '${result.status}'; expected 'received'`
      );
    }
    res.status(200).json(result.order);
  });

  router.post('/orders/:poNumber/shipments', async (req, res) => {
    const err = validateShipment(req.body);
    if (err) {
      return sendError(res, 400, 'VALIDATION_ERROR', err);
    }
    const result = await createShipment(req.params.poNumber, req.body);
    if (result.error === 'PO_NOT_FOUND') {
      return sendError(res, 404, 'PO_NOT_FOUND', `Purchase order ${req.params.poNumber} not found`);
    }
    if (result.error === 'INVALID_STATE') {
      return sendError(
        res,
        409,
        'INVALID_STATE',
        `Cannot ship order in status '${result.status}'; expected 'acknowledged'`
      );
    }
    res.status(201).json(result.shipment);
  });

  router.get('/orders/:poNumber/shipments', async (req, res) => {
    const result = await listShipments(req.params.poNumber);
    if (result.error === 'PO_NOT_FOUND') {
      return sendError(res, 404, 'PO_NOT_FOUND', `Purchase order ${req.params.poNumber} not found`);
    }
    res.status(200).json({ shipments: result.shipments });
  });

  router.get('/slow', async (req, res) => {
    const ms = Math.max(0, Number.parseInt(String(req.query.ms ?? '3000'), 10) || 3000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    res.status(200).json({ sleptMs: ms });
  });

  router.get('/fail', (_req, res) => {
    sendError(res, 500, 'INTENTIONAL_FAILURE', 'This endpoint always fails for gateway error tests');
  });

  router.get('/openapi.json', (_req, res) => {
    try {
      const raw = readFileSync(openapiPath, 'utf8');
      const doc = yaml.load(raw);
      res.status(200).json(doc);
    } catch (e) {
      sendError(res, 500, 'OPENAPI_ERROR', e.message);
    }
  });

  return router;
}
