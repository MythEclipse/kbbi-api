/**
 * Build the runtime dump from the raw KBBI dataset.
 *
 * The upstream script wrote one file per word (112,645 of them) and then read
 * every one back to assemble the upload chunks — 500MB written and re-parsed
 * to produce 500MB. This writes the chunks directly from the parsed dataset.
 *
 * The dataset location is configurable because it is not vendored: local
 * development has it checked out beside this repo, CI clones it, the Nix
 * derivation stages it into the source root, and the Docker build copies it in.
 * Hardcoding one path would make three of those four break.
 *
 * Output, consumed by `src/data/load-dictionary.ts`:
 *   kv-data/__index_words__.json        string[]           every headword
 *   kv-data/__index_non_standard.json   Record<form, word> colloquial → standard
 *   kv-data/__index_phrases__.json      string[]           multi-word headwords
 *   kv-data/bulk_upload_N.json          [{key, value}]     entries, chunked
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EntryRecord } from "../src/domain/types.js";

/** Entries per chunk. 10k keeps each file comfortably small to parse at boot. */
const CHUNK_SIZE = 10_000;

const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const DATASET_DIRECTORY =
  process.env.KBBI_DATASET_DIR ??
  join(REPOSITORY_ROOT, "kbbi-dataset-kbbi-v-main", "json");
const OUTPUT_DIRECTORY = process.env.KBBI_OUTPUT_DIR ?? join(REPOSITORY_ROOT, "kv-data");

/** The dataset is one JSON object per part, keyed by headword. */
type DatasetPart = Record<string, EntryRecord>;

/**
 * Colloquial forms found under an entry, mapped to their standard headword.
 *
 * Collected in dataset order, so the last writer wins for a form listed under
 * several headwords — arbitrary but deterministic, and the alternative (a
 * first-wins rule) would silently drop the KBBI's own ordering without saying
 * so.
 */
function collectNonStandardForms(
  records: DatasetPart,
  forms: Record<string, string>,
): void {
  for (const [headword, record] of Object.entries(records)) {
    for (const entry of record.data?.entri ?? []) {
      for (const form of entry.bentuk_tidak_baku ?? []) {
        forms[form.toLowerCase()] = headword.toLowerCase();
      }
    }
  }
}

/** Every `kbbi_v_part*.json` in the dataset, in filename order. */
function findDatasetParts(): string[] {
  return readdirSync(DATASET_DIRECTORY)
    .filter((name) => name.startsWith("kbbi_v_part") && name.endsWith(".json"))
    .sort();
}

/** Longest phrase headword in the dataset is 48 chars after this filter. */
const MAX_PHRASE_TOKENS = 4;

/**
 * Whether a headword is a phrase a client can match inside running text.
 *
 * Multi-word headwords are where KBBI meaning diverges from the words a
 * client would look up one by one ("kambing hitam" ≠ kambing + hitam), so
 * the moderation gateway needs their whole list. Three exclusions keep the
 * list to things a sentence can contain:
 *   - parenthesised heads are cross-references with a placeholder slot
 *     ("(sbg durian) pangsa menunjukkan bangsa"), not phrases a user types;
 *   - stricture exceptions: none — anything with a paren also fails the
 *     token filter below only when it is a single slot;
 *   - very long peribahasas up to 18 tokens would never match a message and
 *     bloat the payload, so two-to-four words is the working band
 *     (covers 36,546 of 37,468 phrase keys).
 */
function isMatchablePhrase(key: string): boolean {
  if (!key.includes(" ")) return false;
  if (key.includes("(")) return false;
  const tokens = key.split(/\s+/);
  return tokens.length >= 2 && tokens.length <= MAX_PHRASE_TOKENS;
}

function main(): void {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  const parts = findDatasetParts();
  if (parts.length === 0) {
    throw new Error(
      `no dataset parts under ${DATASET_DIRECTORY} — clone the dataset first`,
    );
  }

  console.log(`reading ${parts.length} dataset parts from ${DATASET_DIRECTORY}`);

  const headwords: string[] = [];
  const nonStandardForms: Record<string, string> = {};
  const phraseHeadwords: string[] = [];
  let chunk: { key: string; value: string }[] = [];
  let chunkNumber = 1;

  const flushChunk = (): void => {
    if (chunk.length === 0) return;
    const path = join(OUTPUT_DIRECTORY, `bulk_upload_${chunkNumber}.json`);
    writeFileSync(path, JSON.stringify(chunk));
    console.log(`  wrote ${path} (${chunk.length} entries)`);
    chunk = [];
    chunkNumber += 1;
  };

  for (const part of parts) {
    const records = JSON.parse(
      readFileSync(join(DATASET_DIRECTORY, part), "utf8"),
    ) as DatasetPart;

    const words = Object.keys(records);
    console.log(`  ${part}: ${words.length} entries`);

    collectNonStandardForms(records, nonStandardForms);

    for (const [headword, record] of Object.entries(records)) {
      const key = headword.toLowerCase();
      headwords.push(key);
      if (isMatchablePhrase(key)) phraseHeadwords.push(key);
      chunk.push({ key, value: JSON.stringify(record) });
      if (chunk.length >= CHUNK_SIZE) flushChunk();
    }
  }
  flushChunk();

  // Sorted and deduplicated so `search` returns a stable order, and so the
  // loader's completeness check compares against a count no duplicate inflates.
  const uniqueWords = [...new Set(headwords)].sort();
  const uniquePhrases = [...new Set(phraseHeadwords)].sort();
  writeFileSync(
    join(OUTPUT_DIRECTORY, "__index_words__.json"),
    JSON.stringify(uniqueWords),
  );
  writeFileSync(
    join(OUTPUT_DIRECTORY, "__index_non_standard__.json"),
    JSON.stringify(nonStandardForms),
  );
  writeFileSync(
    join(OUTPUT_DIRECTORY, "__index_phrases__.json"),
    JSON.stringify(uniquePhrases),
  );

  console.log(
    `done: ${uniqueWords.length} unique words, ` +
      `${Object.keys(nonStandardForms).length} non-standard forms, ` +
      `${uniquePhrases.length} phrases, ` +
      `${chunkNumber - 1} chunks`,
  );
}

main();