// Tokenizer for the closed Python subset (design §4.1).
// The grammar is deliberately closed: anything outside it is a hard
// error, so the generator vocabulary cannot outgrow the concept
// vocabulary silently (totality rule).
//
// Tokens: NAME, INT, FLOAT, STRING (double-quoted, no escapes), and the
// operators/punctuation + - * ** / // % = += . , : [ ] ( ) { }
// < > <= >= == !=. Keywords (True False None and or not in is if elif else
// for while break continue) are NAME tokens the parser recognises by value.
//
// Compound statements need indentation, so tokenize returns logical lines
// as { indent, toks }, where indent is the count of leading spaces. Tabs
// are rejected (mixed indentation is a hazard the subset simply forbids).

export class AnalyzerError extends Error {
  constructor(code, message, line) {
    super(message);
    this.code = code;
    this.line = line;
  }
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

// Returns an array of logical lines { indent, toks }, each toks an array of
// tokens {type, value, line}. Blank lines are dropped.
export function tokenize(source) {
  const lines = [];
  const rawLines = String(source).split("\n");
  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li];
    const line = li + 1;
    if (raw.trim() === "") continue;
    if (/^\t/.test(raw) || /^ *\t/.test(raw)) {
      throw new AnalyzerError("unmapped-syntax", "tab indentation is outside the subset (use spaces)", line);
    }
    const indent = raw.length - raw.trimStart().length;
    const toks = [];
    let i = indent;
    while (i < raw.length) {
      const c = raw[i];
      if (c === " ") { i++; continue; }
      if (c === '"') {
        const end = raw.indexOf('"', i + 1);
        if (end === -1) throw new AnalyzerError("unmapped-syntax", "unterminated string", line);
        const text = raw.slice(i + 1, end);
        if (text.includes("\\")) throw new AnalyzerError("unmapped-syntax", "string escapes are outside the subset", line);
        toks.push({ type: "STRING", value: text, line });
        i = end + 1;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < raw.length && /[0-9]/.test(raw[j])) j++;
        if (raw[j] === "." && /[0-9]/.test(raw[j + 1] ?? "")) {
          j++;
          while (j < raw.length && /[0-9]/.test(raw[j])) j++;
          if (raw[j] === "." || (raw[j] && NAME_START.test(raw[j]))) {
            throw new AnalyzerError("unmapped-syntax", "malformed number literal", line);
          }
          toks.push({ type: "FLOAT", value: Number(raw.slice(i, j)), line });
          i = j;
          continue;
        }
        if (raw[j] === "." || (raw[j] && NAME_START.test(raw[j]))) {
          throw new AnalyzerError("unmapped-syntax", "malformed number literal", line);
        }
        toks.push({ type: "INT", value: Number(raw.slice(i, j)), line });
        i = j;
        continue;
      }
      if (NAME_START.test(c)) {
        let j = i;
        while (j < raw.length && NAME_CHAR.test(raw[j])) j++;
        toks.push({ type: "NAME", value: raw.slice(i, j), line });
        i = j;
        continue;
      }
      // Two-character operators first (longest match).
      const two = raw.slice(i, i + 2);
      if (["+=", "**", "//", "<=", ">=", "==", "!="].includes(two)) {
        toks.push({ type: "OP", value: two, line });
        i += 2;
        continue;
      }
      if ("+-*/%=.,:[](){}<>".includes(c)) {
        toks.push({ type: "OP", value: c, line });
        i++;
        continue;
      }
      throw new AnalyzerError("unmapped-syntax", `character ${JSON.stringify(c)} is outside the subset`, line);
    }
    if (toks.length) lines.push({ indent, toks });
  }
  return lines;
}
