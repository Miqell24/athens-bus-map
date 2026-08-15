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

// ---------- Greek → Latin, ELOT 743 (= ISO 843 transliteration) ----------
//
// The street-name labels carry the Latin reading under the Greek one, the way
// Greece writes its own signs: the blue street plates and every road sign use
// ELOT 743, so "Πανεπιστημίου" reads "Panepistimiou" here exactly as it does on
// the corner of the street. OSM's own Latin tags were measured against this and
// dropped: int_name covers 27% of the names in the Athens extract and 28% in
// Thessaloniki, mixes transliteration with translation ("Egnatia Odos" vs
// "Egnatia Motorway") and suffix habits ("Odos Agrianon", "G. Stratigi Str."),
// and a fair share of it is simply wrong (Ελευθερίας tagged "Amfitheas",
// 19 Μαΐου tagged "Atlantidos street"). A standard applied by us covers 100% of
// the names with one convention.
//
// The letters are transliterated, not the sounds: ELOT is reversible, which is
// why η and ι both give i, υ gives y, and ω gives o.
const EL_SINGLE = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};
// αυ/ευ/ηυ end in -f before a voiceless consonant and at the end of a word
// (Ελευθερίας → Eleftherias), in -v everywhere else (Ευαγγελισμός → Evangelismos)
const EL_VOICELESS = new Set(['θ', 'κ', 'ξ', 'π', 'σ', 'ς', 'τ', 'φ', 'χ', 'ψ']);
const EL_PAIR = { αι: 'ai', ει: 'ei', οι: 'oi', υι: 'yi', ου: 'ou', γγ: 'ng', γξ: 'nx', γχ: 'nch' };
const EL_WORD = /[Α-Ωα-ωΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰς]+/g;

// One word → letters stripped of their accents, each remembering whether it
// carried one: the accent itself is not transliterated, but it decides whether
// two vowels are a digraph. A diaeresis always splits the pair (Μαϊάμι → Maiami)
// and so does an accent on the FIRST vowel — "άυ" is two sounds (a-y) where
// "αύ" is one digraph (av/af).
const elLetters = (word) => {
  const out = [];
  for (const ch of word.normalize('NFD')) {
    const code = ch.charCodeAt(0);
    if (code >= 0x0300 && code <= 0x036f) {                  // combining mark
      const last = out[out.length - 1];
      if (last) { if (code === 0x0308) last.diaer = true; else last.acute = true; }
      continue;
    }
    out.push({ c: ch.toLowerCase(), up: ch !== ch.toLowerCase(), acute: false, diaer: false });
  }
  return out;
};

const elWord = (word) => {
  const L = elLetters(word);
  if (!L.length) return word;
  // ΑΘΗΝΑ → ATHINA, Αθήνα → Athina: an all-caps word keeps shouting, a
  // capitalized one capitalizes only the first letter of a multi-letter chunk
  const caps = L.length > 1 && L.every((x) => x.up);
  let out = '';
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = L[i + 1];
    let chunk = null, adv = 1;
    if (b && !b.diaer && !a.acute) {
      const pair = a.c + b.c;
      if (pair === 'αυ' || pair === 'ευ' || pair === 'ηυ') {
        const next = L[i + 2] ? L[i + 2].c : '';
        chunk = (pair[0] === 'α' ? 'a' : pair[0] === 'ε' ? 'e' : 'i') +
                (!next || EL_VOICELESS.has(next) ? 'f' : 'v');
        adv = 2;
      } else if (pair === 'μπ') {            // ELOT: b at the start of a word, mp inside
        chunk = i === 0 ? 'b' : 'mp'; adv = 2;
      } else if (EL_PAIR[pair]) {
        chunk = EL_PAIR[pair]; adv = 2;
      }
    }
    if (chunk === null) chunk = EL_SINGLE[a.c] ?? a.c;
    out += caps ? chunk.toUpperCase() : a.up ? chunk.charAt(0).toUpperCase() + chunk.slice(1) : chunk;
    i += adv - 1;
  }
  return out;
};

// Everything that is not a Greek word — digits, "&", Latin fragments, dots —
// passes through untouched, so "Καραολή & Δημητρίου" comes out as
// "Karaoli & Dimitriou" and "Αυτοκινητόδρομος Α621" keeps its number.
export function latinize(name) {
  if (!name || !EL_WORD.test(name)) { EL_WORD.lastIndex = 0; return name; }
  EL_WORD.lastIndex = 0;
  return name.replace(EL_WORD, elWord);
}
