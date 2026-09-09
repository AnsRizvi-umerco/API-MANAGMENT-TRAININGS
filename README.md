# po-api

Small Node.js (Express 4, ES modules) Purchase Orders REST API shaped like EDI **850 / 855 / 856**, backed by MongoDB Atlas via the official `mongodb` driver (no Mongoose).

## Why there is no authentication

This service is intended to sit **behind IBM API Gateway**. The gateway owns:

- Authentication / API keys
- Rate limiting
- CORS / TLS termination
- Request filtering (e.g. stripping `internalCostCenter`)

The backend deliberately has **no auth, no API keys, no rate limiting, no CORS, and no Helmet** so gateway policies can be demonstrated without fighting the app. An optional `GATEWAY_SHARED_SECRET` + `X-Gateway-Secret` check can be enabled only if you need a private shared secret between gateway and backend; it is **off by default**.

## Requirements

- Node.js 18+
- A MongoDB Atlas cluster and connection string

## Atlas setup

1. Create a cluster in [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Create a database user and allow network access (your IP, or `0.0.0.0/0` for demos).
3. Copy the connection string (`mongodb+srv://...`).
4. Copy `.env.example` to `.env` and set:

```bash
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=po_api
PORT=3000
```

On first start, if the `orders` collection is empty, the app seeds **5** purchase orders and initializes atomic ID counters (`PO-####`, `SHP-####`). Responses never include `_id`. `internalCostCenter` is returned so you can strip it with a gateway policy later.

## Run locally

```bash
npm install
npm start
```

Reset data (drop orders/shipments/counters and re-seed):

```bash
npm run reset
```

Smoke test every route:

```bash
./smoke.sh
# or: BASE_URL=http://localhost:3000 ./smoke.sh
```

## Routes

| Method | Path | Notes |
|--------|------|--------|
| GET | `/health` | 200 + db ping; 503 if Atlas unreachable |
| GET | `/echo` | method, path, query, clientIp, all headers |
| GET | `/orders?status=` | list; unknown status → 400 |
| GET | `/orders/:poNumber` | 200 / 404 `PO_NOT_FOUND` |
| POST | `/orders` | create → 201 / 400 |
| POST | `/orders/:poNumber/acknowledge` | received → acknowledged; else 409 |
| POST | `/orders/:poNumber/shipments` | only if acknowledged → 201 + status shipped |
| GET | `/orders/:poNumber/shipments` | list shipments |
| GET | `/slow?ms=3000` | sleep then 200 |
| GET | `/fail` | always 500 |
| GET | `/openapi.json` | OpenAPI 3.0.3 as JSON |

Every response includes `X-Backend-Instance: <hostname>`. Request logs print method, path, status, ms, and the **names** (never values) of `x-gateway-*`, `x-forwarded-*`, and `x-api-key` headers.

## curl examples

```bash
# Health
curl -s http://localhost:3000/health | jq

# List orders
curl -s 'http://localhost:3000/orders' | jq
curl -s 'http://localhost:3000/orders?status=received' | jq

# Create PO
curl -s -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "buyer": "Acme Retail",
    "supplier": "Northwind",
    "lines": [
      { "lineNo": 1, "sku": "WDG-100", "description": "Widget", "qty": 10, "unitPrice": 5.5 }
    ],
    "internalCostCenter": "CC-1001"
  }' | jq

# Acknowledge (855)
curl -s -X POST http://localhost:3000/orders/PO-0001/acknowledge | jq

# Ship (856)
curl -s -X POST http://localhost:3000/orders/PO-0001/shipments \
  -H 'Content-Type: application/json' \
  -d '{
    "carrier": "UPS",
    "trackingNumber": "1Z999AA10123456784",
    "lines": [{ "lineNo": 1, "qty": 10 }]
  }' | jq

# Echo / gateway probes
curl -s http://localhost:3000/echo | jq
curl -s 'http://localhost:3000/slow?ms=100' | jq
curl -s http://localhost:3000/fail | jq
curl -s http://localhost:3000/openapi.json | jq '.openapi'
```

## Deploy

- **Docker**: `docker build -t po-api . && docker run -p 3000:3000 --env-file .env po-api`
- **Render**: `render.yaml` defines a free Node web service; set `MONGODB_URI` in the dashboard.

## Collections

- `orders` — purchase orders
- `shipments` — ASN-style shipments
- `counters` — atomic `PO` / `SHP` sequence generators
