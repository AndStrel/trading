#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "${project_dir}"
exec node --env-file="${project_dir}/.env" "${project_dir}/dist/index.js"
