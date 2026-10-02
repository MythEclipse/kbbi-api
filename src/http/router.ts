import type { IncomingMessage, ServerResponse } from "node:http";
import type { Dictionary } from "../dictionary/dictionary.js";

/** Query string value used when `limit` is absent or unusable. */
const DEFAULT_LIMIT = 10;
/** Ceiling on `limit`, so one caller cannot ask for the whole dictionary. */
const MAX_LIMIT = 100;

/** A response the router decided on: a status plus an already-shaped body. */
interface RouteResult {
  status: number;
  body: unknown;
}

/**
 * One endpoint. `word` says whether the route is keyed on a `:word` path
 * segment; `/api/search` is keyed on the query string instead, and encoding
 * that difference here keeps it out of the control flow.
 */
interface Route {
  word: boolean;
  handle: (word: string, params: URLSearchParams) => RouteResult;
}

function respond(res: ServerResponse, result: RouteResult): void {
  res.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    // The API is a read-only reference over public dictionary data, so any
    // origin may read it.
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=3600",
  });
  res.end(JSON.stringify(result.body));
}

/**
 * Clamp a `limit` query parameter.
 *
 * `Number("abc")` is NaN and `Number("-5")` is negative; either would reach
 * `.slice()` and return nothing or throw. A bad limit is a client mistake, so
 * it falls back to the default rather than becoming a 500.
 */
function readLimit(params: URLSearchParams): number {
  const requested = Number(params.get("limit"));
  if (!Number.isFinite(requested) || requested < 1) return DEFAULT_LIMIT;
  return Math.min(requested, MAX_LIMIT);
}

/**
 * Decode a path segment, treating malformed input as absent rather than
 * throwing.
 *
 * `decodeURIComponent` raises `URIError` on a truncated escape
 * (`/api/word/kel%2`). Node runs request handlers synchronously and does not
 * catch what they throw, so an uncaught `URIError` here takes down the
 * process — one bad URL would take the whole service offline. A client that
 * cannot spell the word has not found the word, so `null` (and a 404) is both
 * safe and the truthful answer.
 */
function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Service description served at the root, so an operator can self-check. */
const ENDPOINTS = [
  "GET /api/lookup/:word",
  "GET /api/word/:word",
  "GET /api/check/:word",
  "GET /api/similar/:word?limit=n",
  "GET /api/search?q=&limit=n",
  "GET /api/stats",
];

/**
 * Build the request handler for a dictionary.
 *
 * A table rather than a `switch`: six endpoints share one response shape and
 * one preamble, and the one real variation — whether a word is required — is
 * a property of the endpoint, not a branch inside it.
 *
 * The dictionary arrives as a parameter, so this stays pure and testable
 * against a four-word fake.
 *
 * This layer only translates path and query into dictionary calls. Case
 * normalisation lives in the dictionary, which owns the lowercase-index
 * invariant — doing it here too would mean two places to change when the rule
 * changes, and two answers if only one is updated.
 */
export function createRequestHandler(
  dictionary: Dictionary,
): (req: IncomingMessage, res: ServerResponse) => void {
  const routes: Record<string, Route> = {
    stats: {
      word: false,
      handle: () => ({ status: 200, body: dictionary.stats() }),
    },

    lookup: {
      word: true,
      handle: (word) => ({ status: 200, body: dictionary.exists(word) }),
    },

    word: {
      word: true,
      handle: (word) => {
        const entry = dictionary.lookup(word);
        return entry
          ? { status: 200, body: entry }
          : { status: 404, body: { status: "not_found", word } };
      },
    },

    check: {
      word: true,
      handle: (word) => ({ status: 200, body: dictionary.check(word) }),
    },

    similar: {
      word: true,
      handle: (word, params) => ({
        status: 200,
        body: {
          word,
          suggestions: dictionary.findSimilar(word, readLimit(params)),
        },
      }),
    },

    search: {
      word: false,
      handle: (_word, params) => {
        const query = params.get("q") ?? "";
        // Refusing an empty query rather than matching everything: `/api/search`
        // with no `q` is a client mistake, and answering with 10,000 words
        // would disguise it as a successful result.
        if (!query) {
          return {
            status: 400,
            body: { error: "Query parameter (q) is required" },
          };
        }
        return { status: 200, body: dictionary.search(query, readLimit(params)) };
      },
    },
  };

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments[0] !== "api") {
      respond(res, {
        status: 200,
        body: { name: "kbbi-api", endpoints: ENDPOINTS },
      });
      return;
    }

    const route = routes[segments[1] ?? ""];
    const word = route?.word === true ? decodeSegment(segments[2]) : "";

    // A required-but-unreadable word 404s as a missing route, so "no word
    // given" is never reported as "not a word" — those are different claims.
    if (!route || (route.word && word === null)) {
      respond(res, {
        status: 404,
        body: { error: "NOT_FOUND", path: url.pathname },
      });
      return;
    }

    respond(res, route.handle(word ?? "", url.searchParams));
  };
}