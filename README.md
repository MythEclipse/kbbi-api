# KBBI API

Self-hosted REST API over the Indonesian dictionary (KBBI) — 112,645 headwords,
3,619 non-standard forms. Built with [Bun](https://bun.sh) and TypeScript, zero
runtime dependencies.

Built as a grounding reference for an LLM moderation pipeline: when a model
claims an Indonesian word means something it does not, the dictionary settles
it.

## Quick start

```bash
bun install
bun run prepare-data   # builds kv-data/ from the raw dataset (one-off, ~1 min)
bun run dev            # http://localhost:8080
```

`prepare-data` needs the raw dataset at `kbbi-dataset-kbbi-v-main/json/`:

```bash
git clone https://github.com/damzaky/kumpulan-kata-bahasa-indonesia-KBBI.git
```

## Endpoints

All lookups are case-insensitive. Errors are JSON.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/lookup/:word` | Does the dictionary have this word? |
| `GET /api/word/:word` | Full entry: meanings, word class, etymology, examples |
| `GET /api/check/:word` | Is it standard, non-standard, or unknown? |
| `GET /api/similar/:word?limit=n` | Typo suggestions (Levenshtein ≤ 3) |
| `GET /api/search?q=&limit=n` | Prefix and substring search |
| `GET /api/stats` | Word and non-standard form counts |

`limit` defaults to 10 and is capped at 100. A missing or unparseable value
falls back to the default rather than failing the request.

```bash
curl localhost:8080/api/lookup/keluarga
# {"exists":true,"word":"keluarga"}

curl localhost:8080/api/check/ritma
# {"word":"ritma","is_standard":false,"standard_form":"ritme"}

curl 'localhost:8080/api/similar/kelakuam?limit=2'
# {"word":"kelakuam","suggestions":[{"word":"kelakuan","distance":1},...]}

curl 'localhost:8080/api/search?q=kelak&limit=3'
# {"query":"kelak","count":3,"results":["kelak","kelak-kelik","kelak-keluk"]}
```

## Why `check` has three answers, not two

`is_standard` is `true`, `false`, or `null`. The `null` is load-bearing: it says
the dictionary has no entry for the word, which is a different claim from `false`
("the dictionary judged it and found it non-standard"). Collapsing them would
mean reporting unknown words as misspelled.

`bentuk_tidak_baku` outranks entry presence. 3,061 of the 3,619 mapped forms also
have entries of their own — most because that entry is a bare cross-reference
(`ritma` → `ritme`) with no definition of its own. Judging by entry presence alone
reported `abadiat` as standard when the dataset says otherwise.

## Architecture

```
src/
  server.ts                    entrypoint — construction, nothing else
  http/router.ts               path/query → dictionary calls; one route table
  dictionary/dictionary.ts     Dictionary interface + in-memory implementation
  domain/levenshtein.ts        edit distance, pure
  domain/types.ts              entry shapes
  data/load-dictionary.ts      reads kv-data/ once at boot
scripts/prepare-data.ts        dataset → kv-data/ (build-time only)
tests/                        41 tests, no network, no fixtures on disk
```

Four layers, dependencies pointing inward only: `http` → `dictionary` →
`domain`. `data` is a constructor detail of `server.ts`, not a layer the domain
knows about. The `Dictionary` interface is what lets the router and the
dictionary be tested against a four-word fake.

The dictionary loads the whole dataset into memory at boot (~1s) and is
read-only afterwards. Boot **fails loudly** if the dump is missing or truncated —
a silently empty dictionary answers `{"exists": false}` to every word while
looking perfectly healthy.

Case normalisation lives in the dictionary, not the router, because the
lowercase-index invariant is owned there. Doing it in both places would mean two
answers whenever only one is updated.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `KBBI_DATA_DIR` | `./kv-data` | Dump location |

## Deploy

Production is the **imrnes VPS**, running the Docker image. It is not deployed to
the Orange box and not published to Cloudflare — the upstream project was a
Workers deployment, and this is a self-hosted Node/Bun service instead.

```bash
git clone <repo> /opt/kbbi-api && cd /opt/kbbi-api
# The dump is baked into the image, so the dataset must be present:
git clone --depth 1 https://github.com/damzaky/kumpulan-kata-bahasa-indonesia-KBBI.git kbbi-dataset-kbbi-v-main
docker compose up -d --build
curl -sf http://127.0.0.1:4020/api/stats
```

The service listens on `127.0.0.1:4020` on the host (container `8080`) —
deliberately not 8080, which GMW's backend already holds on that host. Put nginx
or Caddy in front for TLS if it should be reachable publicly.

Because the dump is baked in, a dictionary refresh is a **rebuild**, not a
restart. The image runs unprivileged with a read-only root and a 512MB cap, and
its healthcheck asserts the dictionary actually loaded (`total_words` ≥ 100,000)
rather than just that the port answers.

### Nix

Also packaged with Nix, for hosts that prefer the store:

```bash
nix build .#server      # typecheck + tests run inside the derivation
nix build .#dictionary  # just the generated dump
./result/bin/kbbi-api   # KBBI_DATA_DIR wired to the store path
nix develop             # dev shell with bun + node
```

## Development

```bash
bun run typecheck    # tsc --noEmit
bun test             # 41 tests
bun run check        # both
```

CI (`.github/workflows/ci.yml`) runs four jobs: typecheck + tests + a live smoke
test, a Nix build, a Docker build-and-smoke-test, and — on `main` only — a deploy
to imrnes followed by a verification request against the live service.

## Data source

[`damzaky/kumpulan-kata-bahasa-indonesia-KBBI`](https://github.com/damzaky/kumpulan-kata-bahasa-indonesia-KBBI),
following [baguskto/kbbi-api](https://github.com/baguskto/kbbi-api) for the
endpoint shape.

All data is owned by Badan Pengembangan dan Pembinaan Bahasa, Kementerian
Pendidikan, Kebudayaan, Riset, dan Teknologi Republik Indonesia. Non-commercial use
only — see the dataset README.

MIT for the code; the data carries its own terms.