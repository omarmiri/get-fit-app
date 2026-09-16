#!/usr/bin/env bash
#
# Deploy Rack & File to AWS.
#
# Safe to run repeatedly: the CloudFormation stack converges, and the two
# upload steps replace what is there. The first run creates a CloudFront
# distribution and takes several minutes; later runs take about thirty seconds.
#
#   ./infra/deploy.sh
#
# Sign-in is off unless Supabase is configured. It is identity only — no
# training data — and everything except the account backup works without it:
#
#   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=... ./infra/deploy.sh
set -euo pipefail

STACK=rackfile
REGION=us-east-1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

params=()
if [ -n "${SUPABASE_URL:-}" ]; then
  params+=("SupabaseUrl=${SUPABASE_URL}" "SupabaseAnonKey=${SUPABASE_ANON_KEY:-}")
fi

echo "==> Building"
npm run build

echo "==> Packaging the function"
python infra/package-lambda.py

echo "==> Applying the stack"
aws cloudformation deploy \
  --template-file infra/stack.yml \
  --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM \
  --region "$REGION" \
  --no-fail-on-empty-changeset \
  ${params:+--parameter-overrides "${params[@]}"}

read_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(read_output BucketName)"
DIST="$(read_output DistributionId)"
FUNCTION="$(read_output FunctionName)"

echo "==> Publishing the function"
aws lambda update-function-code \
  --function-name "$FUNCTION" \
  --zip-file fileb://infra/function.zip \
  --region "$REGION" \
  --no-cli-pager >/dev/null
aws lambda wait function-updated --function-name "$FUNCTION" --region "$REGION"

# Fingerprinted files first, and with a long immutable lifetime. Uploading
# these before the shell means a browser that fetches the new HTML can always
# find the assets it references — the reverse order leaves a window where the
# shell points at files that are not there yet.
echo "==> Uploading assets"
aws s3 sync dist/assets "s3://$BUCKET/assets" \
  --region "$REGION" \
  --cache-control "public, max-age=31536000, immutable" \
  --delete

# Everything else must revalidate: the HTML shell, the service worker and the
# manifest. Caching these is how a deployed fix never reaches a phone that
# already has the old copy.
echo "==> Uploading the shell"
aws s3 sync dist "s3://$BUCKET" \
  --region "$REGION" \
  --exclude "assets/*" \
  --cache-control "no-cache" \
  --delete

# Only the files that are allowed to change in place. Never /assets/* — those
# are immutable by construction, and invalidating them would be paying to
# discard a cache entry that can never be stale.
echo "==> Invalidating"
aws cloudfront create-invalidation \
  --distribution-id "$DIST" \
  --paths "/" "/index.html" "/sw.js" "/manifest.webmanifest" "/llms.txt" "/catalog.json" \
  --no-cli-pager >/dev/null

echo
echo "Done — $(read_output SiteUrl)"
