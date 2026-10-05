import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EntryRecord } from "../domain/types.js";
import { InMemoryDictionary, type Dictionary } from "../dictionary/dictionary.js";

/** Chunk prefix emitted by the prepare step. */
const CHUNK_PREFIX = "bulk_upload_";

/** Index files written by the prepare step. */
const WORD_INDEX_FILE = "__index_words__.json";
const VARIANT_INDEX_FILE = "__index_non_standard__.json";
const PHRASE_INDEX_FILE = "__index_phrases__.json";

/** One `{key, value}` pair from a dump chunk; `value` is a JSON string. */
interface DumpPair {
  key: string;
  value: string;
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Parse one dump pair into an entry, or `null` if the value is unusable.
 *
 * A single corrupt entry must not cost the caller 112,644 good ones, so a bad
 * pair is dropped rather than thrown. Failing the whole boot instead would
 * turn one bad byte in a 500MB dump into a total outage.
 */
function parseEntry(pair: DumpPair): EntryRecord | null {
  if (!pair.key || pair.key.startsWith("__")) return null;
  try {
    return JSON.parse(pair.value) as EntryRecord;
  } catch {
    return null;
  }
}

/**
 * Collect every `bulk_upload_N.json` chunk in order.
 *
 * The loop probes for N = 1, 2, 3 … and stops at the first gap, so the chunk
 * count is never hardcoded: a re-generated dump with a different split still
 * loads completely.
 */
function* readChunks(dataDirectory: string): Generator<DumpPair[]> {
  for (let n = 1; ; n++) {
    const path = join(dataDirectory, `${CHUNK_PREFIX}${n}.json`);
    if (!existsSync(path)) return;
    yield JSON.parse(readFileSync(path, "utf8")) as DumpPair[];
  }
}

/**
 * Build the dictionary from the prepared dump on disk.
 *
 * Reads ~500MB of JSON once, at boot. That is the right trade for a read-only
 * dictionary: per-request disk reads would turn a 1ms lookup into a 40ms one,
 * and the process is a long-lived server regardless.
 */
export function loadDictionary(dataDirectory: string): Dictionary {
  const index = readJsonFile<string[]>(join(dataDirectory, WORD_INDEX_FILE), []);
  const nonStandard = readJsonFile<Record<string, string>>(
    join(dataDirectory, VARIANT_INDEX_FILE),
    {},
  );
  // Missing on dumps prepared before the phrase index existed. An old dump
  // still answers every word endpoint correctly, so the phrase list degrades
  // to empty rather than failing boot — only `/api/phrases` goes empty.
  const phrases = readJsonFile<string[]>(
    join(dataDirectory, PHRASE_INDEX_FILE),
    [],
  );

  // No index means no dump was prepared, and a `[]` fallback here would let
  // boot succeed with an empty dictionary — every lookup answering "not a
  // word" while the process looked perfectly healthy. Refuse instead.
  if (index.length === 0) {
    throw new Error(
      `no word index at ${join(dataDirectory, WORD_INDEX_FILE)}. ` +
        `Run the prepare step first: bun run prepare-data`,
    );
  }

  const entries = new Map<string, EntryRecord>();
  for (const chunk of readChunks(dataDirectory)) {
    for (const pair of chunk) {
      const entry = parseEntry(pair);
      if (entry) entries.set(pair.key, entry);
    }
  }

  // The index is the dump's own claim about its size. A shortfall means a
  // chunk is missing; an index without its entries would make `lookup` answer
  // "not a word" for words the dictionary demonstrably contains, which is the
  // worst failure mode for a reference service because it is silent.
  if (entries.size < index.length) {
    throw new Error(
      `dictionary incomplete: loaded ${entries.size} entries but index claims ` +
        `${index.length}. Re-run the prepare step; a dump chunk is missing or corrupt.`,
    );
  }

  return new InMemoryDictionary(entries, index, nonStandard, phrases);
}