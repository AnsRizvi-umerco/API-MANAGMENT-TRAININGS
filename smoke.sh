#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0

pass() {
  echo "PASS  $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL  $1 — $2"
  FAIL=$((FAIL + 1))
}

check_status() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$name (HTTP $actual)"
  else
    fail "$name" "expected HTTP $expected, got $actual"
  fi
}

json_field() {
  # usage: json_field '.path' <<< "$body"
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=process.argv[1].replace(/^\\./,'').split('.'); let v=d; for (const k of p){ if(k==='') continue; v=v?.[k]; } if(v===undefined||v===null) process.exit(2); process.stdout.write(String(v));" "$1"
}

echo "=== po-api smoke tests against $BASE_URL ==="

# GET /health
code=$(curl -s -o /tmp/po_health.json -w "%{http_code}" "$BASE_URL/health")
check_status "GET /health" "200" "$code"

# GET /echo
code=$(curl -s -o /tmp/po_echo.json -w "%{http_code}" -H "X-Forwarded-For: 203.0.113.10" "$BASE_URL/echo")
check_status "GET /echo" "200" "$code"
if [[ "$code" == "200" ]]; then
  method=$(json_field '.method' < /tmp/po_echo.json || true)
  if [[ "$method" == "GET" ]]; then
    pass "GET /echo body.method"
  else
    fail "GET /echo body.method" "expected GET, got $method"
  fi
fi

# GET /orders
code=$(curl -s -o /tmp/po_orders.json -w "%{http_code}" "$BASE_URL/orders")
check_status "GET /orders" "200" "$code"

# GET /orders?status=invalid
code=$(curl -s -o /tmp/po_bad_status.json -w "%{http_code}" "$BASE_URL/orders?status=invalid")
check_status "GET /orders?status=invalid" "400" "$code"

# GET /orders?status=received
code=$(curl -s -o /tmp/po_received.json -w "%{http_code}" "$BASE_URL/orders?status=received")
check_status "GET /orders?status=received" "200" "$code"

# Pick a received PO for acknowledge / ship flow; create a fresh one for isolation
code=$(curl -s -o /tmp/po_create.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"buyer":"Smoke Buyer","supplier":"Smoke Supplier","lines":[{"lineNo":1,"sku":"SMK-1","description":"Smoke item","qty":2,"unitPrice":9.99}],"internalCostCenter":"CC-SMOKE"}' \
  "$BASE_URL/orders")
check_status "POST /orders" "201" "$code"
PO=$(json_field '.poNumber' < /tmp/po_create.json 2>/dev/null || echo "")
if [[ -z "$PO" ]]; then
  fail "POST /orders body.poNumber" "missing poNumber"
  PO="PO-MISSING"
else
  pass "POST /orders returned $PO"
fi

# GET /orders/:poNumber
code=$(curl -s -o /tmp/po_one.json -w "%{http_code}" "$BASE_URL/orders/$PO")
check_status "GET /orders/$PO" "200" "$code"

# GET missing
code=$(curl -s -o /tmp/po_missing.json -w "%{http_code}" "$BASE_URL/orders/PO-DOES-NOT-EXIST")
check_status "GET /orders/PO-DOES-NOT-EXIST" "404" "$code"

# POST acknowledge
code=$(curl -s -o /tmp/po_ack.json -w "%{http_code}" -X POST "$BASE_URL/orders/$PO/acknowledge")
check_status "POST /orders/$PO/acknowledge" "200" "$code"

# POST acknowledge again -> 409
code=$(curl -s -o /tmp/po_ack2.json -w "%{http_code}" -X POST "$BASE_URL/orders/$PO/acknowledge")
check_status "POST /orders/$PO/acknowledge (again)" "409" "$code"

# POST shipment
code=$(curl -s -o /tmp/po_ship.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"carrier":"FedEx","trackingNumber":"FX123456","lines":[{"lineNo":1,"qty":2}]}' \
  "$BASE_URL/orders/$PO/shipments")
check_status "POST /orders/$PO/shipments" "201" "$code"

# POST shipment again -> 409 (now shipped)
code=$(curl -s -o /tmp/po_ship2.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"carrier":"FedEx","trackingNumber":"FX999","lines":[{"lineNo":1,"qty":1}]}' \
  "$BASE_URL/orders/$PO/shipments")
check_status "POST /orders/$PO/shipments (again)" "409" "$code"

# GET shipments
code=$(curl -s -o /tmp/po_ships.json -w "%{http_code}" "$BASE_URL/orders/$PO/shipments")
check_status "GET /orders/$PO/shipments" "200" "$code"

# GET /slow with short delay
code=$(curl -s -o /tmp/po_slow.json -w "%{http_code}" "$BASE_URL/slow?ms=50")
check_status "GET /slow?ms=50" "200" "$code"

# GET /fail
code=$(curl -s -o /tmp/po_fail.json -w "%{http_code}" "$BASE_URL/fail")
check_status "GET /fail" "500" "$code"

# GET /openapi.json
code=$(curl -s -o /tmp/po_openapi.json -w "%{http_code}" "$BASE_URL/openapi.json")
check_status "GET /openapi.json" "200" "$code"
if [[ "$code" == "200" ]]; then
  oaid=$(node -e "const d=require('/tmp/po_openapi.json'); if(d.openapi!=='3.0.3') process.exit(1);" && echo ok || echo bad)
  if [[ "$oaid" == "ok" ]]; then
    pass "GET /openapi.json openapi=3.0.3"
  else
    fail "GET /openapi.json openapi" "expected 3.0.3"
  fi
fi

# POST /orders validation error
code=$(curl -s -o /tmp/po_bad_create.json -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -d '{"buyer":"Only Buyer"}' \
  "$BASE_URL/orders")
check_status "POST /orders (invalid)" "400" "$code"

echo "=== Results: $PASS passed, $FAIL failed ==="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
