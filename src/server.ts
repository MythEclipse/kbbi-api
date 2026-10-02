/**
 * Service entrypoint.
 *
 * Construction happens here and nowhere else: the dictionary is loaded from
 * disk once, the handler is built from it, and the server only listens. That
 * ordering is deliberate — if the dump is missing or truncated the process
 * fails during boot with a specific message, instead of starting and answering
 * `{"exists": false}` for every word, which is the failure mode that leaves a
 * reference service quietly useless.
 */
import { createServer } from "node:http";
import { join } from "node:path";
import { loadDictionary } from "./data/load-dictionary.js";
import { createRequestHandler } from "./http/router.js";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIRECTORY =
  process.env.KBBI_DATA_DIR ?? join(import.meta.dirname, "..", "kv-data");

const dictionary = loadDictionary(DATA_DIRECTORY);
const { total_words: totalWords, non_standard_forms: nonStandardForms } =
  dictionary.stats();

createServer(createRequestHandler(dictionary)).listen(PORT, () => {
  console.log(
    `kbbi-api listening on :${PORT} — ${totalWords} words, ` +
      `${nonStandardForms} non-standard forms, from ${DATA_DIRECTORY}`,
  );
});