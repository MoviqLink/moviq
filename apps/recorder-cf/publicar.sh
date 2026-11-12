#!/bin/sh
# Publishes the recorder to MovIQ's Cloudflare account, only after the CPU guard, the type check
# and the tests pass. Run from anywhere: ./apps/recorder-cf/publicar.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
cd "$ROOT"
echo "1/4 CPU budget"
(cd "$HERE" && node --single-threaded --conditions=moviq-source --import tsx tools/cpu-budget.ts)
echo "2/4 types"
npx tsc -p apps/recorder-cf
echo "3/4 tests"
npx vitest run apps/recorder-cf apps/server/tests/recorder
echo "4/4 publish"
cd "$HERE"
exec "${WRANGLER_BIN:-wrangler}" deploy
