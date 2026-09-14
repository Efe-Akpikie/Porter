#!/bin/bash
set -e
pnpm install --frozen-lockfile
# SQLite schema initialization and seed data run automatically with the API.
