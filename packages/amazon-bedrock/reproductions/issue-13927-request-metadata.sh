#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

pnpm --dir packages/amazon-bedrock build
node packages/amazon-bedrock/reproductions/issue-13927-request-metadata.mjs
