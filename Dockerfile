# syntax=docker/dockerfile:1

# Multi-stage: the dictionary dump is ~74MB of generated JSON and the dev
# toolchain is several hundred MB. Neither belongs in the runtime image, so the
# builder produces both the sources and the dump, and the final stage copies
# only what the service reads at runtime.

# 1.4.2, not 1.3-alpine: bun.lock is lockfileVersion 2, which Bun 1.3 cannot
# parse ("Unknown lockfile version"). The tag must track whatever wrote
# bun.lock, or `bun install --frozen-lockfile` fails before any code runs.
FROM oven/bun:1.4.2-alpine AS builder

WORKDIR /build

# Copy manifests first so `bun install` is cached independently of source edits.
# The service has zero runtime dependencies — only tsc and the Bun types are
# installed, so this layer is small and rarely invalidates.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
# The 143MB upstream dataset, fetched (not vendored — see .gitignore). The dump
# is generated from it, so it must be present at build time. Only json/ is
# needed; prepare-data.ts reads no other part.
COPY kbbi-dataset-kbbi-v-main/json ./kbbi-dataset-kbbi-v-main/json

# Fail the build on a type error or a failing test rather than discovering it at
# runtime on the VPS.
RUN ./node_modules/.bin/tsc --noEmit
RUN bun test

RUN bun run scripts/prepare-data.ts

# Count assertion, not just "the file exists". A truncated dump parses fine and
# would boot into a service that answers {"exists": false} for every word while
# reporting healthy — the exact failure this check exists to prevent.
RUN WORDS=$(bun -e 'const i = await Bun.file("kv-data/__index_words__.json").json(); console.log(i.length)') \
 && FORMS=$(bun -e 'const n = await Bun.file("kv-data/__index_non_standard__.json").json(); console.log(Object.keys(n).length)') \
 && echo "dictionary: $WORDS words, $FORMS non-standard forms" \
 && [ "$WORDS" -gt 100000 ] \
 && [ "$FORMS" -gt 1000 ]


FROM oven/bun:1.4.2-alpine AS runtime

# tini reaps zombies and forwards SIGTERM, so `docker stop` reaches Bun and the
# container exits promptly instead of waiting out the 10s kill timeout.
RUN apk add --no-cache tini

# Run unprivileged. The image needs no write access at runtime: the dump is
# baked in and read-only, and the service writes nothing to disk.
RUN addgroup -S kbbi && adduser -S -G kbbi kbbi

WORKDIR /app

COPY --from=builder --chown=kbbi:kbbi /build/src ./src
COPY --from=builder --chown=kbbi:kbbi /build/kv-data ./kv-data
COPY --from=builder --chown=kbbi:kbbi /build/package.json ./package.json

ENV PORT=8080 \
    KBBI_DATA_DIR=/app/kv-data

USER kbbi

EXPOSE 8080

# Hardcoded 8080, not $PORT: Dockerfile HEALTHCHECK runs through `/bin/sh -c`,
# where ${process.env.PORT} is a POSIX parameter expansion and fails with
# "bad substitution". Compose form is the same string for the same reason.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun --eval 'const r = await fetch("http://127.0.0.1:8080/api/stats"); if (!r.ok) process.exit(1); const s = await r.json(); if (s.total_words < 100000) { console.error("dictionary incomplete: " + s.total_words + " words"); process.exit(1); }'

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["bun", "run", "src/server.ts"]