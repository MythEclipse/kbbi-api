# syntax=docker/dockerfile:1

# Multi-stage: the dictionary dump is ~74MB of generated JSON and the dev
# toolchain is several hundred MB. Neither belongs in the runtime image, so the
# builder produces both the sources and the dump, and the final stage copies
# only what the service reads at runtime.

FROM node:22-slim AS builder

# The default /bin/sh is dash, which has no `pipefail`, so `pnpm test | tee`
# would report success because `tee` exits 0 even when the test run failed.
# bash ships with the Debian-based image; this applies to every later RUN here.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# corepack ships with Node and installs the exact pnpm named by the
# `packageManager` field in package.json — one source of truth instead of a
# second version pinned in this file. Without it, the first download prompts
# "Ok to proceed?", and a build has no TTY to answer with.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /build

# Copy manifests first so `pnpm install` is cached independently of source edits.
# The service has zero runtime dependencies — only tsc, tsx and vitest are
# installed, so this layer is small and rarely invalidates.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# tests/ must be in the builder or the test gate below finds nothing. vitest
# exits 1 on "No test files found", so a build context missing tests/ fails the
# build instead of reporting a passing gate over zero tests.
COPY tests ./tests
# The 143MB upstream dataset, fetched (not vendored — see .gitignore). The dump
# is generated from it, so it must be present at build time. Only json/ is
# needed; prepare-data.ts reads no other part.
COPY kbbi-dataset-kbbi-v-main/json ./kbbi-dataset-kbbi-v-main/json

# Fail the build on a type error or a failing test rather than discovering it at
# runtime on the VPS.
RUN pnpm run typecheck

# Output captured rather than streamed away, so the count assertion below reads
# the same run that could have failed instead of re-running the suite.
RUN pnpm test 2>&1 | tee /tmp/vitest.log
# Pinned to the `Tests  N passed` row: a bare grep of the summary matches the
# `Test Files` line first and would assert on 3 instead of the test count. 50 is
# the count this guard was written against — a suite that silently shrinks below
# it is a failure, not a pass.
RUN COUNT=$(grep -E '^[[:space:]]*Tests[[:space:]]' /tmp/vitest.log | grep -oE '[0-9]+' | head -1) \
 && [ "${COUNT:-0}" -ge 50 ] \
 || { echo "FAIL: expected at least 50 passing tests, saw ${COUNT:-0}"; exit 1; }

RUN pnpm run prepare-data

# Count assertion, not just "the file exists". A truncated dump parses fine and
# would boot into a service that answers {"exists": false} for every word while
# reporting healthy — the exact failure this check exists to prevent. Read with
# node's own `fs`, so the check does not depend on the test runner or on tsx.
RUN WORDS=$(node -e 'const fs = require("node:fs"); console.log(JSON.parse(fs.readFileSync("kv-data/__index_words__.json", "utf8")).length)') \
 && FORMS=$(node -e 'const fs = require("node:fs"); console.log(Object.keys(JSON.parse(fs.readFileSync("kv-data/__index_non_standard__.json", "utf8"))).length)') \
 && echo "dictionary: $WORDS words, $FORMS non-standard forms" \
 && [ "$WORDS" -gt 100000 ] \
 && [ "$FORMS" -gt 1000 ]


FROM node:22-slim AS runtime

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# tini reaps zombies and forwards SIGTERM, so `docker stop` reaches node and the
# container exits promptly instead of waiting out the 10s kill timeout.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Run unprivileged. The image needs no write access at runtime: the dump is
# baked in and read-only, and the service writes nothing to disk.
RUN groupadd --system kbbi && useradd --system --gid kbbi --home-dir /app kbbi

WORKDIR /app

# Installed here rather than copied out of the builder: pnpm writes absolute
# build-directory paths into node_modules/.bin/*, so a tree built under /build
# would point at a directory that does not exist under /app. Same manifests, same
# lockfile, so this resolves to exactly what the builder typechecked and tested.
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY --from=builder --chown=kbbi:kbbi /build/src ./src
COPY --from=builder --chown=kbbi:kbbi /build/kv-data ./kv-data

ENV PORT=8080 \
    KBBI_DATA_DIR=/app/kv-data

USER kbbi

EXPOSE 8080

# Hardcoded 8080, not $PORT: Dockerfile HEALTHCHECK runs through `/bin/sh -c`,
# where ${process.env.PORT} is a POSIX parameter expansion and fails with
# "bad substitution". Compose form is the same string for the same reason.
#
# A promise chain rather than `await`: `node -e` evaluates CommonJS unless told
# otherwise, and top-level await is a syntax error there.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:8080/api/stats").then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))).then(s => { if (s.total_words < 100000) { console.error("dictionary incomplete: " + s.total_words); process.exit(1); } }).catch(e => { console.error(e); process.exit(1); })'

ENTRYPOINT ["/sbin/tini", "--"]
# tsx executes the TypeScript sources directly — no compile step and no dist/
# to keep in sync. The .bin shim is a POSIX script, so tini can exec it without
# a shell of its own.
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
