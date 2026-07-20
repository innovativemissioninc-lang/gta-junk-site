#!/bin/sh
# Pre-deploy guard. Fails if unresolved placeholder tokens would ship to production.
set -e
FOUND=$(grep -rl '{{STARTING_PRICE' --include='*.html' . || true)
if [ -n "$FOUND" ]; then
  echo "BLOCKED: unresolved price tokens in:"
  echo "$FOUND"
  echo ""
  echo "Replace {{STARTING_PRICE_CLEAROUT}}, {{STARTING_PRICE_RESET}} and"
  echo "{{STARTING_PRICE_TRANSFORMATION}} with confirmed figures before deploying."
  exit 1
fi
echo "OK — no unresolved price tokens."
