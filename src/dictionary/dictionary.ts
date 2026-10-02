import { findTypos } from "../domain/levenshtein.js";
import type {
  EntryRecord,
  LookupResult,
  SearchResult,
  StandardnessResult,
  Suggestion,
} from "../domain/types.js";

/**
 * The read side of the dictionary: everything a caller can ask about a word.
 *
 * Declared as an interface so the HTTP layer never touches the loader, the
 * loader never touches HTTP, and a test can stand in a hand-built dictionary
 * with four words instead of 112,645. That separation is the whole reason the
 * domain types carry no I/O.
 */
export interface Dictionary {
  exists(word: string): LookupResult;
  lookup(word: string): EntryRecord | null;
  check(word: string): StandardnessResult;
  findSimilar(word: string, limit: number): Suggestion[];
  search(query: string, limit: number): SearchResult;
  stats(): { total_words: number; non_standard_forms: number };
}

/**
 * In-memory dictionary over a pre-built index.
 *
 * Headword lookup, standardness and search are a map read or a linear scan
 * over the index array; only typo suggestions touch every entry. That
 * asymmetry is why the index is kept as an array rather than collapsed into
 * the Map alone — `search` and `findSimilar` both need to iterate it.
 *
 * Every method normalises its own input. The index is lowercase, so the
 * invariant belongs here rather than in the transport layer that happens to
 * call first — otherwise a caller reaching the dictionary directly gets
 * different answers from the same word, depending on the path taken.
 */
export class InMemoryDictionary implements Dictionary {
  constructor(
    private readonly entries: ReadonlyMap<string, EntryRecord>,
    private readonly index: readonly string[],
    private readonly nonStandard: Readonly<Record<string, string>>,
  ) {}

  exists(word: string): LookupResult {
    const key = word.toLowerCase();
    return { exists: this.entries.has(key), word: key };
  }

  lookup(word: string): EntryRecord | null {
    return this.entries.get(word.toLowerCase()) ?? null;
  }

  /**
   * Three-way answer, not two. A word the dictionary has heard of is standard;
   * a word in the dataset's variant map is non-standard with a known correct
   * form; a word the dictionary has never heard of is neither. Collapsing that
   * last case into `false` would assert the dictionary judged a word it has no
   * entry for.
   *
   * `bentuk_tidak_baku` is consulted first even when the word also has an
   * entry of its own, because that field exists precisely to declare a form
   * non-standard. 3,061 of the 3,619 mapped forms are also headwords — most
   * because their entry is a bare cross-reference (`ritma` → `ritme`) with no
   * definition. Judging those by entry-presence alone would report `abadiat`
   * as standard when the dataset says it is not.
   */
  check(word: string): StandardnessResult {
    const key = word.toLowerCase();
    const standardForm = this.nonStandard[key];
    if (standardForm) {
      return { word: key, is_standard: false, standard_form: standardForm };
    }
    if (this.entries.has(key)) {
      return { word: key, is_standard: true, standard_form: key };
    }
    return { word: key, is_standard: null, standard_form: null };
  }

  findSimilar(word: string, limit: number): Suggestion[] {
    return findTypos(word.toLowerCase(), this.index, 3, limit);
  }

  /**
   * Prefix matches rank above substring matches. `mau` should offer `mau`
   * itself before `menyambut` — a caller typing a headword is nearly always
   * completing it, not searching for something that contains it.
   */
  search(query: string, limit: number): SearchResult {
    const needle = query.toLowerCase();
    const matches = this.index
      .filter((word) => word.includes(needle))
      .sort((a, b) => {
        const aStarts = a.startsWith(needle);
        const bStarts = b.startsWith(needle);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b);
      })
      .slice(0, limit);

    return { query: needle, count: matches.length, results: matches };
  }

  stats() {
    return {
      total_words: this.index.length,
      non_standard_forms: Object.keys(this.nonStandard).length,
    };
  }
}