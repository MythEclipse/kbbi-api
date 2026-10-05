import { describe, expect, it } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { InMemoryDictionary } from "../src/dictionary/dictionary.js";
import { createRequestHandler } from "../src/http/router.js";
import type { EntryRecord } from "../src/domain/types.js";

function entry(headword: string): EntryRecord {
  return {
    status: "success",
    data: {
      pranala: `https://kbbi.kemdikbud.go.id/entri/${headword}`,
      entri: [],
    },
  };
}

function stubDictionary(): InMemoryDictionary {
  return new InMemoryDictionary(
    new Map([
      ["kelakuan", entry("kelakuan")],
      ["keluarga", entry("keluarga")],
    ]),
    ["keluarga", "kelakuan"],
    {},
  );
}

/** Capture what the handler wrote, without binding a socket. */
function capture(path: string) {
  const chunks: string[] = [];
  let statusCode = 0;
  const res = {
    writeHead(status: number) {
      statusCode = status;
      return this;
    },
    end(payload?: string) {
      if (payload) chunks.push(payload);
      return this;
    },
  } as unknown as ServerResponse;

  createRequestHandler(stubDictionary())(
    { url: path } as IncomingMessage,
    res,
  );

  return { statusCode, body: JSON.parse(chunks.join("") || "{}") };
}

describe("routing", () => {
  it("describes itself at the root", () => {
    expect(capture("/").body.name).toBe("kbbi-api");
  });

  it("answers /api/stats", () => {
    expect(capture("/api/stats").body).toEqual({
      total_words: 2,
      non_standard_forms: 0,
      total_phrases: 0,
    });
  });

  it("answers /api/phrases", () => {
    const response = capture("/api/phrases");
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ count: 0, phrases: [] });
  });

  it("404s an unknown word with a machine-readable status", () => {
    const response = capture("/api/word/tidakada");
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ status: "not_found", word: "tidakada" });
  });

  it("404s an unknown endpoint", () => {
    expect(capture("/api/nope").statusCode).toBe(404);
  });

  it("lowercases the word so lookups are case-insensitive", () => {
    expect(capture("/api/word/KELAKUAN").statusCode).toBe(200);
  });

  it("decodes a percent-encoded word", () => {
    const encoded = encodeURIComponent("kelakuan");
    expect(capture(`/api/word/${encoded}`).statusCode).toBe(200);
  });

  /**
   * Regression: a truncated escape made `decodeURIComponent` throw inside the
   * handler, and Node does not catch it — the process died, taking every
   * subsequent request offline with it.
   */
  it("survives a malformed percent-escape", () => {
    expect(capture("/api/word/kel%2").statusCode).toBe(404);
  });

  it("answers 404, not a false negative, when no word is given", () => {
    const response = capture("/api/word/");
    expect(response.statusCode).toBe(404);
    expect(response.body.status).toBeUndefined();
  });
});

describe("limit parameter", () => {
  it("caps the result count", () => {
    // "kelakua" is one edit from "kelakuan" and five from "keluarga", so the
    // limit is not what decides here — it must return exactly the one match.
    expect(capture("/api/similar/kelakua?limit=1").body.suggestions).toEqual([
      { word: "kelakuan", distance: 1 },
    ]);
  });

  it("falls back to the default when the value is not a number", () => {
    expect(capture("/api/similar/kel?limit=abc").statusCode).toBe(200);
  });

  it("clamps a negative limit instead of returning nothing", () => {
    const response = capture("/api/search?q=kel&limit=-5");
    expect(response.body.results.length).toBeGreaterThan(0);
  });

  it("does not let a huge limit return the whole dictionary", () => {
    const response = capture("/api/search?q=ke&limit=999999");
    expect(response.body.results.length).toBeLessThanOrEqual(100);
  });
});

describe("search without a query", () => {
  it("400s rather than searching for everything", () => {
    const response = capture("/api/search");
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toContain("q");
  });

  it("400s on an empty q", () => {
    expect(capture("/api/search?q=").statusCode).toBe(400);
  });
});
describe("/api/words", () => {
  it("returns one result per requested word, in order", () => {
    const response = capture("/api/words?words=keluarga&words=kelakuan");
    expect(response.statusCode).toBe(200);
    expect(response.body.results.map((r: { word: string }) => r.word)).toEqual([
      "keluarga",
      "kelakuan",
    ]);
    expect(response.body.results[0].status).toBe("success");
  });

  /**
   * The property the moderation gateway depends on. It maps results back onto
   * the words it asked about, so a response that omitted unknown words would
   * shift every later definition onto the wrong word — a wrong-meaning
   * attribution that is silent, not an error.
   */
  it("keeps a not_found placeholder in position rather than omitting it", () => {
    const response = capture("/api/words?words=tidakada&words=keluarga");
    expect(response.body.results.length).toBe(2);
    expect(response.body.results[0]).toMatchObject({
      word: "tidakada",
      status: "not_found",
      entry: null,
    });
    // The word after the unknown one must still resolve — that is the whole
    // point of positional correspondence.
    expect(response.body.results[1].status).toBe("success");
  });

  it("carries the standardness check alongside the entry", () => {
    const response = capture("/api/words?words=keluarga");
    expect(response.body.results[0].standard).toEqual({
      word: "keluarga",
      is_standard: true,
      standard_form: "keluarga",
    });
  });

  it("400s with no words rather than answering about nothing", () => {
    const response = capture("/api/words");
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toContain("words");
  });

  it("caps the batch so one request cannot name the dictionary", () => {
    const many = Array.from({ length: 200 }, (_, i) => `words=k${i}`).join("&");
    const response = capture(`/api/words?${many}`);
    expect(response.statusCode).toBe(400);
    expect(response.body.error).toContain("maximum");
  });

  it("rejects a pasted sentence without discarding the valid words", () => {
    const sentence = "a".repeat(80);
    const response = capture(`/api/words?words=${sentence}&words=keluarga`);
    expect(response.body.results[0].status).toBe("invalid");
    expect(response.body.results[1].status).toBe("success");
  });
});
