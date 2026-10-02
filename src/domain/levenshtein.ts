import type { Suggestion } from "./types.js";

/**
 * Levenshtein edit distance, two-row variant.
 *
 * The full matrix is the textbook version and allocates O(n*m) rows; this
 * keeps one row and overwrites it left to right, which is all the recurrence
 * actually needs. Both probe strings here are short dictionary words, so the
 * saving is modest — but `findTypos` calls this once per dictionary entry, and
 * that is 112k array allocations per typo query otherwise.
 */
export function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: left.length + 1 }, (_, i) => i);

  for (let row = 1; row <= right.length; row++) {
    // Seeded with `row` so column 0 stays the row index; every other cell is
    // overwritten below, so nothing here depends on the array being pre-filled.
    const current: number[] = new Array<number>(left.length + 1);
    current[0] = row;

    for (let column = 1; column <= left.length; column++) {
      const diagonal = previous[column - 1] ?? 0;
      const leftNeighbour = current[column - 1] ?? row;
      const aboveNeighbour = previous[column] ?? 0;

      current[column] =
        right[row - 1] === left[column - 1]
          ? diagonal
          : Math.min(diagonal + 1, leftNeighbour + 1, aboveNeighbour + 1);
    }
    previous = current;
  }

  return previous[left.length] ?? left.length;
}

/**
 * Words within `maxDistance` edits of `word`, nearest first.
 *
 * Excludes an exact match: "similar" means typo help, and offering the input
 * back as its own first suggestion is noise. An empty result is the honest
 * answer for a word nothing resembles, so it is returned rather than thrown.
 */
export function findTypos(
  word: string,
  dictionary: readonly string[],
  maxDistance = 3,
  limit = 10,
): Suggestion[] {
  return dictionary
    .map((candidate) => ({
      word: candidate,
      distance: editDistance(word, candidate),
    }))
    .filter(
      (suggestion) =>
        suggestion.distance > 0 && suggestion.distance <= maxDistance,
    )
    .sort((a, b) => a.distance - b.distance || a.word.localeCompare(b.word))
    .slice(0, limit);
}