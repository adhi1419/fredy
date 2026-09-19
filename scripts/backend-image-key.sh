#!/usr/bin/env bash
# Hash exactly the files copied or interpreted by the backend Docker build.
set -euo pipefail

git ls-files -s -- Dockerfile package.json yarn.lock index.js lib | sha256sum | cut -d' ' -f1
