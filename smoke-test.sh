#!/usr/bin/env bash
# Smoke test for the property listings API.
# Runs one full cycle (create, list, get, update, delete) and checks each HTTP status.
# It creates its own listing and deletes it, so your existing listings are not touched.
#
# Usage: bash smoke-test.sh https://YOUR-API-ID.execute-api.eu-west-2.amazonaws.com

set -u
if [ $# -lt 1 ]; then
  echo "Usage: bash smoke-test.sh https://YOUR-API-ID.execute-api.eu-west-2.amazonaws.com"
  exit 2
fi
API_URL="${1%/}"
pass=0
fail=0

check() {  # check <name> <expected status> <actual status>
  if [ "$2" = "$3" ]; then
    echo "PASS  $1 (HTTP $3)"
    pass=$((pass + 1))
  else
    echo "FAIL  $1 (expected HTTP $2, got HTTP $3)"
    fail=$((fail + 1))
  fi
}

request() {  # request <method> <path> [json body]; sets STATUS and BODY
  local method=$1 path=$2 data=${3:-} out
  if [ -n "$data" ]; then
    out=$(curl -s -w $'\n%{http_code}' -X "$method" "$API_URL$path" \
      -H "Content-Type: application/json" -d "$data")
  else
    out=$(curl -s -w $'\n%{http_code}' -X "$method" "$API_URL$path")
  fi
  STATUS=${out##*$'\n'}
  BODY=${out%$'\n'*}
}

echo "Testing $API_URL"
echo

# 1. Create
request POST /listings '{"title":"Smoke test listing","location":"Test City","price":1000,"type":"land"}'
check "Create listing" 201 "$STATUS"
ID=$(echo "$BODY" | grep -o '"listingId":"[^"]*"' | cut -d'"' -f4)
if [ -z "$ID" ]; then
  echo "FAIL  No listingId in the create response. Stopping."
  exit 1
fi
echo "      listingId: $ID"

# 2. Validation: an invalid type must be rejected
request POST /listings '{"title":"Bad","location":"X","price":1,"type":"house"}'
check "Reject invalid type" 400 "$STATUS"

# 3. List
request GET /listings
check "List listings" 200 "$STATUS"

# 4. Get one
request GET "/listings/$ID"
check "Get listing" 200 "$STATUS"

# 5. Update
request PUT "/listings/$ID" '{"status":"sold"}'
check "Update listing" 200 "$STATUS"
if echo "$BODY" | grep -q '"status":"sold"'; then
  echo "PASS  Status is now sold"
  pass=$((pass + 1))
else
  echo "FAIL  Status was not updated to sold"
  fail=$((fail + 1))
fi

# 6. Delete
request DELETE "/listings/$ID"
check "Delete listing" 200 "$STATUS"

# 7. The deleted listing must be gone
request GET "/listings/$ID"
check "Get deleted listing" 404 "$STATUS"

# 8. Deleting twice must report not found
request DELETE "/listings/$ID"
check "Delete again" 404 "$STATUS"

echo
echo "Passed: $pass   Failed: $fail"
[ "$fail" -eq 0 ]
