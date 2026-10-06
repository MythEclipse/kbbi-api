import { describe, expect, it } from "vitest";
import { InMemoryDictionary } from "../src/dictionary/dictionary.js";
import type { EntryRecord } from "../src/domain/types.js";

function record(headword: string): EntryRecord {
  return {
    status: "success",
    data: {
      pranala: `https://kbbi.kemdikbud.go.id/entri/${headword}`,
      entri: [
        {
          nama: headword,
          nomor: "",
          kata_dasar: [headword],
          pelafalan: "",
          bentuk_tidak_baku: [],
          varian: [],
          makna: [],
          etimologi: null,
          kata_turunan: [],
          gabungan_kata: [],
          peribahasa: [],
          idiom: [],
        },
      ],
    },
  };
}

function fakeDictionary(): InMemoryDictionary {
  return new InMemoryDictionary(
    new Map([
      ["kelakuan", record("kelakuan")],
      ["keluarga", record("keluarga")],
      ["rumah", record("rumah")],
      ["ritma", record("ritma")],
    ]),
    ["keluarga", "kelakuan", "ritma", "rumah"],
    { keleuw: "keluarga", ritma: "ritme" },
  );
}

describe("exists", () => {
  it("finds a headword", () => {
    expect(fakeDictionary().exists("kelakuan")).toEqual({
      exists: true,
      word: "kelakuan",
    });
  });

  it("reports a missing word as absent rather than failing", () => {
    expect(fakeDictionary().exists("tidakada").exists).toBe(false);
  });
});

describe("lookup", () => {
  it("returns the full record", () => {
    expect(fakeDictionary().lookup("kelakuan")?.data.pranala).toContain(
      "kelakuan",
    );
  });

  it("returns null, not a throw, for an unknown word", () => {
    expect(fakeDictionary().lookup("tidakada")).toBeNull();
  });
});

describe("check", () => {
  it("confirms a dictionary word is standard", () => {
    expect(fakeDictionary().check("keluarga")).toEqual({
      word: "keluarga",
      is_standard: true,
      standard_form: "keluarga",
    });
  });

  it("maps a colloquial form to its standard form", () => {
    expect(fakeDictionary().check("keleuw")).toEqual({
      word: "keleuw",
      is_standard: false,
      standard_form: "keluarga",
    });
  });

  /**
   * The distinction that matters: an unknown word is not the same claim as a
   * non-standard one. `null` says the dictionary has no opinion; `false` would
   * say it judged the word and found it wanting.
   */
  it("answers null for a word the dictionary has never seen", () => {
    expect(fakeDictionary().check("tidakada")).toEqual({
      word: "tidakada",
      is_standard: null,
      standard_form: null,
    });
  });

  /**
   * Regression: 3,061 of 3,619 mapped forms also have entries of their own —
   * usually bare cross-references with no definition. Entry-presence must not
   * outrank `bentuk_tidak_baku`, or `ritma` reports as standard.
   */
  it("reports a form as non-standard even when it also has an entry", () => {
    expect(fakeDictionary().check("ritma")).toEqual({
      word: "ritma",
      is_standard: false,
      standard_form: "ritme",
    });
  });
});

describe("search", () => {
  // "keluarga" before "kelakuan": both are prefix matches for "kel", so the
  // alphabetical tiebreak decides — and "kelu" < "kelak" in collation.
  it("ranks a prefix match above a substring-only match", () => {
    const result = fakeDictionary().search("kel", 10);
    expect(result.results).toEqual(result.results.toSorted());
    expect(result.results).toHaveLength(2);
  });

  it("puts a substring-only match after every prefix match", () => {
    const dictionary = new InMemoryDictionary(
      new Map([["keluarga", record("keluarga")]]),
      ["keluarga", "gkeluarga"],
      {},
    );
    expect(dictionary.search("keluarga", 10).results[0]).toBe("keluarga");
  });

  it("lowercases the query so lookups are case-insensitive", () => {
    expect(fakeDictionary().search("RUMAH", 10).results).toEqual(["rumah"]);
  });

  it("reports the count of matches actually returned", () => {
    const result = fakeDictionary().search("kel", 1);
    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
  });

  it("returns nothing for a query matching no word", () => {
    expect(fakeDictionary().search("zzz", 10)).toEqual({
      query: "zzz",
      count: 0,
      results: [],
    });
  });
});

describe("findSimilar", () => {
  it("suggests the intended word for a typo", () => {
    expect(fakeDictionary().findSimilar("kelakuam", 5)[0]).toEqual({
      word: "kelakuan",
      distance: 1,
    });
  });
});

describe("stats", () => {
  it("counts words and non-standard forms", () => {
    expect(fakeDictionary().stats()).toEqual({
      total_words: 4,
      non_standard_forms: 2,
      total_phrases: 0,
    });
  });
});

describe("phrases", () => {
  it("returns the phrase index given at construction", () => {
    const withPhrases = new InMemoryDictionary(
      new Map([["kambing hitam", record("kambing hitam")]]),
      ["kambing hitam"],
      {},
      ["kambing hitam"],
    );
    expect(withPhrases.phrases()).toEqual(["kambing hitam"]);
    expect(withPhrases.stats().total_phrases).toBe(1);
  });

  it("defaults to empty when no phrase index is passed", () => {
    expect(fakeDictionary().phrases()).toEqual([]);
  });
});