// ALL-CAPS Greek stop names → normal mixed case.
//
// The operator's feed shouts every stop name (ΓΕΦΥΡΑ ΑΤΤΙΚΗΣ ΟΔΟΥ) while the
// street names on the map come from OSM in proper case (Αττικής Οδού), and the
// two sit next to each other. Lowercasing is not a `toLowerCase()` away:
// Greek writes accents in lowercase but drops them in capitals, so the feed
// simply does not contain the information — ΑΤΤΙΚΗΣ gives no clue that it is
// Αττικής. What it does contain is words that also exist, properly written, in
// OSM: street names, squares, districts, churches, schools. So we build a
// dictionary of accented word forms out of the OSM extracts we already
// download, and rewrite the caps names word by word through it. In Athens that
// resolves ~80% of the words; whatever is left falls back to plain title case,
// which is at worst an unaccented — but readable — Greek word.
//
// (The final sigma needs no special handling: JavaScript's toLowerCase applies
// the Unicode Final_Cased rule, so ΟΔΟΣ correctly becomes οδός/οδος, not οδοσ.)

// Accents live in the combining range; NFD + strip is the standard fold.
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const GREEK_UPPER = /[Α-ΩΆΈΉΊΌΎΏΪΫ]/;
const HAS_LOWER = /[α-ωa-zά-ώ]/;
// Word characters for the dictionary: Greek in both cases plus Latin, so that
// names like "Nea Kifissia" do not get chopped.
const WORD = /[A-Za-zΑ-Ωα-ωΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰς]+/g;

// Institutions and initialisms that are written in capitals in normal Greek
// text too — title-casing them would produce nonsense (Ικα, Ηsαπ). Anything
// with an internal dot (Ε.ΘΕ.Λ., Τ.Σ.) is caught by the dot rule instead.
const ACRONYMS = new Set([
  'ΙΚΑ', 'ΟΤΕ', 'ΔΕΗ', 'ΗΣΑΠ', 'ΚΑΠΗ', 'ΟΑΚΑ', 'ΚΤΕΛ', 'ΣΕΦ', 'ΟΑΣΑ', 'ΟΣΕ',
  'ΟΣΥ', 'ΣΤΑΣΥ', 'ΕΥΔΑΠ', 'ΕΛΤΑ', 'ΤΕΙ', 'ΑΕΙ', 'ΚΕΠ', 'ΟΛΠ', 'ΟΛΘ', 'ΕΚΑΒ',
  'ΚΑΤ', 'ΚΤΕΟ', 'ΕΜΠ', 'ΑΣΟΕΕ', 'ΑΠΘ', 'ΔΕΘ', 'ΕΡΤ', 'ΒΙΠΕ', 'ΒΙΟΠΑ', 'ΕΛΠΕ',
  'ΠΑΟ', 'ΑΕΚ', 'ΠΑΟΚ', 'ΙΚΕΑ', 'ΒΙΕΧ', 'ΧΥΤΑ', 'ΟΑΕΔ', 'ΕΦΚΑ', 'ΠΕΔΥ', 'ΔΟΥ', 'ΟΠΑΠ',
]);

// A dictionary of accented word forms, harvested from every name in the OSM
// extracts. Words that appear in several spellings keep the commonest one.
export function buildNameDict(osmDocs) {
  const seen = new Map(); // folded word → Map(spelling → count)
  for (const doc of osmDocs) {
    for (const e of doc.elements || []) {
      const name = e.tags && e.tags.name;
      if (!name || !HAS_LOWER.test(name)) continue; // caps names teach us nothing
      for (const w of name.match(WORD) || []) {
        if (w.length < 3) continue;
        const k = norm(w);
        let m = seen.get(k);
        if (!m) seen.set(k, (m = new Map()));
        m.set(w, (m.get(w) || 0) + 1);
      }
    }
  }
  const dict = new Map();
  for (const [k, m] of seen) {
    let best = null, bestN = -1;
    for (const [w, n] of m) if (n > bestN) { best = w; bestN = n; }
    dict.set(k, best);
  }
  return dict;
}

const titleWord = (w) => w.charAt(0) + w.slice(1).toLowerCase();

// Latin capitals that look exactly like Greek ones. Typists reach for them by
// accident, and the feed is full of words like ΝερατZIΩΤΙΣΣΑ or ΠεριφερEΙΑΚΗ
// where a couple of letters are Latin. Left alone they split the word in two
// and half of it stays shouting, so in a MIXED token they are folded back to
// Greek. A token that is entirely Latin is left as it is — it may really be
// Latin (a platform letter "A", "Nea Kifissia").
const LOOKALIKE = { A: 'Α', B: 'Β', E: 'Ε', Z: 'Ζ', H: 'Η', I: 'Ι', K: 'Κ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Ρ', T: 'Τ', Y: 'Υ', X: 'Χ' };
const foldLatin = (tok) => (
  /[Α-Ωα-ω]/.test(tok) && /[A-Z]/.test(tok)
    ? tok.replace(/[A-Z]/g, (c) => LOOKALIKE[c] || c)
    : tok);

// Rewrite one name, WORD BY WORD: a word that already carries a lowercase
// letter is left exactly as it is — that covers the metro feed, which writes
// its stations properly, and the ordinal endings the bus feed does keep
// ("14η ΝΤΑΜΑΡΙΑ" must lose the caps without touching the "14η").
export function greekTitleCase(name, dict) {
  if (!name || !GREEK_UPPER.test(name)) return name;
  const rewrite = (core) => {
    if (ACRONYMS.has(core)) return core;
    // an abbreviation (ΑΓ., ΠΛ., ΠΡΟΦ.) reads as a word, so it gets title case
    const known = dict && dict.get(norm(core));
    return known ? titleWord(known) : titleWord(core);
  };
  // Hyphenated names are judged half by half: "Ομόνοια-ΣΩΚΡΑΤΟΥΣ" has one side
  // already written properly and one still shouting.
  const casePart = (raw) => {
    const tok = foldLatin(raw);
    if (!GREEK_UPPER.test(tok) || HAS_LOWER.test(tok)) return tok; // digits, Latin, already cased
    // Ε.ΘΕ.Λ., Τ.Σ. — every piece is an initial, so the whole token stays as
    // it is. "ΑΓ.ΒΑΡΒΑΡΑΣ" is not that: one piece is a whole word, so the
    // token is rewritten piece by piece (→ Αγ.Βαρβάρας).
    const parts = tok.split('.');
    const solid = parts.filter(Boolean);
    if (solid.length > 1 && solid.every((p) => p.length <= 3)) return tok;
    return parts.map((p) => {
      // A slash marks a shortened word (ΑΜ/ΣΙΟ = αμαξοστάσιο, ΠΛ/ΤΕΙΑ), so
      // only the head is a name — the tail is the end of one word and stays
      // lowercase.
      const [head, ...tail] = p.split('/');
      const m = /^([^Α-ΩΆΈΉΊΌΎΏΪΫ]*)([Α-ΩΆΈΉΊΌΎΏΪΫ]+)(.*)$/.exec(head);
      const done = m ? m[1] + rewrite(m[2]) + m[3] : head;
      return [done, ...tail.map((t) => t.toLowerCase())].join('/');
    }).join('.');
  };
  return name.split(/(\s+)/)
    .map((tok) => tok.split(/(-)/).map((p) => (p === '-' ? p : casePart(p))).join(''))
    .join('');
}
