#!/usr/bin/env bash
# ============================================================================
# Deploys the five changed/new Edge Functions and sets the one new secret.
# Run it from anywhere; it finds the repo from its own location.
#
#   ./rollout/deploy-functions.sh
#
# What it needs from you, once: the Supabase CLI logged in as you. The script
# checks and tells you exactly what to run if it isn't. Everything else is
# automatic, and running it twice is harmless — deploys are idempotent and
# the HEALTH_SECRET is only generated if it doesn't already exist.
#
# Deliberately NOT touched: ebas, tickets, stripe-webhook (unchanged this
# round), anything in the dashboard, and the database — SQL goes in through
# rollout/apply-phases-15-20.sql, by hand, the way it always has.
# ============================================================================
set -euo pipefail

PROJECT_REF="uwawugvatencvzvvfaeq"
cd "$(dirname "$0")/.."

if ! command -v supabase >/dev/null 2>&1; then
  echo "The Supabase CLI isn't installed. On this Mac:"
  echo "    brew install supabase/tap/supabase"
  echo "then run this script again."
  exit 1
fi

if ! supabase projects list >/dev/null 2>&1; then
  echo "The CLI isn't logged in. Run:"
  echo "    supabase login"
  echo "(opens the browser once), then run this script again."
  exit 1
fi

# Link is idempotent; it may ask for the database password the first time.
supabase link --project-ref "$PROJECT_REF"

# All five run without a Supabase JWT at the door — the cron functions are
# gated by x-cron-secret (plus the admin-JWT test path checked inside),
# health by HEALTH_SECRET, wallet by Apple's per-pass tokens. Hence
# --no-verify-jwt on every one.
for fn in member-emails event-emails weekly-digest health wallet; do
  echo "── deploying $fn"
  supabase functions deploy "$fn" --no-verify-jwt
done

# HEALTH_SECRET: create only if absent, and print the monitor URL either way.
if supabase secrets list | grep -q "^ *HEALTH_SECRET"; then
  echo "HEALTH_SECRET already set — leaving it alone."
  echo "Monitor URL: https://${PROJECT_REF}.supabase.co/functions/v1/health?key=<the existing secret>"
else
  SECRET="$(openssl rand -hex 24)"
  supabase secrets set "HEALTH_SECRET=${SECRET}"
  echo ""
  echo "HEALTH_SECRET set. Point a free uptime monitor (keyword: \"ok\":true) at:"
  echo "  https://${PROJECT_REF}.supabase.co/functions/v1/health?key=${SECRET}"
fi

echo ""
echo "Done. Still yours to do, in the dashboard / GitHub:"
echo "  1. Paste rollout/apply-phases-15-20.sql into the SQL editor and run it."
echo "  2. Repo Settings -> Secrets -> Actions -> add SUPABASE_DB_URL, then run"
echo "     the 'Database backup' workflow once from the Actions tab."
echo "  3. Admin panel -> Overview -> Security -> enrol MFA (both admins)."
echo "  4. Optional baseline when you have a quiet hour: supabase db pull"
