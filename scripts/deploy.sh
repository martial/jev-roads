#!/bin/sh
# Deploys to App Engine on the project gcloud is set to. The secrets travel in env.yaml, written here from .env
# and never committed (both are in .gitignore). Usage: npm run deploy [-- --project screen-club]
set -e
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then echo "No .env (copy .env.example); the TypeSafe key is optional, the rest has defaults." >&2; exit 1; fi
{
  echo "# Written by scripts/deploy.sh from .env; do not commit."
  echo "env_variables:"
  grep -E '^(TYPESAFE_API_KEY|TYPESAFE_MODEL|GEMINI_MODEL|DRIVER_TTS|DRIVER_VOICE|DRIVER_PACE)=' .env | sed -E 's/^([A-Z_]+)=(.*)$/  \1: "\2"/' | grep -v ': ""$' || true
} > env.yaml
npm run typecheck
gcloud app deploy app.yaml --quiet "$@"
rm -f env.yaml
