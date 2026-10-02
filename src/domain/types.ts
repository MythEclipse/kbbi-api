/**
 * KBBI entry shape, as published by the upstream dataset.
 *
 * The dataset is scraped from kbbi.kemdikbud.go.id, so the wire format is
 * Indonesian snake_case nested two levels deep under `{status, data}`. Nothing
 * here is renamed: a rename would make the loader lie about what it read from
 * disk, and anyone debugging against the raw dataset would have to translate
 * in their head.
 */

/** Word class, e.g. `Nomina` / `Verba`. Absent for phrases and idioms. */
export interface WordClass {
  kode: string;
  nama: string;
  deskripsi: string;
}

/** One sense: a word class plus its definitions and examples. */
export interface Sense {
  kelas: WordClass[];
  submakna: string[];
  info: string;
  contoh: string[];
}

/** A single headword record. One word can carry several senses. */
export interface Entry {
  nama: string;
  nomor: string;
  kata_dasar: string[];
  pelafalan: string;
  bentuk_tidak_baku: string[];
  varian: string[];
  makna: Sense[];
  etimologi: string | null;
  kata_turunan: string[];
  gabungan_kata: string[];
  peribahasa: string[];
  idiom: string[];
}

/** The full record the API returns for one word. */
export interface EntryRecord {
  status: "success";
  data: {
    pranala: string;
    entri: Entry[];
  };
}

/** What `lookup` answers: is this a headword in the dictionary at all. */
export interface LookupResult {
  exists: boolean;
  word: string;
}

/**
 * What `check` answers: is this the standard form, a known colloquial variant,
 * or not in the dictionary at all. `null` means "no opinion" — conflating that
 * with `false` would tell a caller that a word is non-standard when really the
 * dictionary has never heard of it.
 */
export interface StandardnessResult {
  word: string;
  is_standard: boolean | null;
  standard_form: string | null;
}

/** One typo candidate. */
export interface Suggestion {
  word: string;
  distance: number;
}

/** What `search` answers. */
export interface SearchResult {
  query: string;
  count: number;
  results: string[];
}