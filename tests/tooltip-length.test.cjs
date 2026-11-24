/**
 * Tooltip and section-note length (index.html + the Spanish mirror).
 *
 * #app-tooltip is 340px wide with no height cap (css/tooltips.css), so a
 * 1,800-character title renders ~55 lines and runs off the bottom of a 1080p
 * viewport — computeTooltipPosition clamps the top and the rest is cut off.
 * A tooltip says what the number is and how it is computed; the rationale
 * belongs in the code comments, not in the hover.
 *
 * This is the regression guard: the cap is a hard limit on the STATIC chrome
 * authored in index.html (title="" attributes and the *_desc section notes),
 * plus the Spanish translations of those same slugs, PLUS every sentence any
 * js/*.js hands to tx() for a runtime cell tooltip.
 *
 * The runtime cap is per SENTENCE, and it is tighter than the static one: a
 * cell tooltip is composed by appending several of them, so the composed string
 * is what the user actually reads. That total is guarded separately in
 * tests/tooltip-runtime-length.test.cjs.
 *
 * Run: node tests/tooltip-length.test.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { readIndexHtml } = require("./helpers/page-source.cjs");

const ROOT = path.join(__dirname, "..");
const html = readIndexHtml();

// The written target is ~160 characters; the cap leaves headroom for a formula
// or a unit that genuinely needs the room. Spanish runs ~15% longer than the
// English it translates, so it gets its own cap rather than a shared one.
const EN_CAP = 200;
const ES_CAP = 230;

// Runtime sentences are appended to each other inside one tooltip, so each one
// gets less room than a whole static tooltip does.
const RUNTIME_EN_CAP = 160;
const RUNTIME_ES_CAP = 190;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const lineOf = (idx) => html.slice(0, idx).split("\n").length;
const report = (rows, cap) => rows
  .map((r) => `      ${r.where} (${r.len} > ${cap}): ${r.text.slice(0, 60)}…`)
  .join("\n");

// ── the static chrome ───────────────────────────────────────────────────────

test(`no title="" in index.html is longer than ${EN_CAP} characters`, () => {
  const re = /<[a-zA-Z][^>]*?title="([^"]*)"[^>]*>/g;
  const over = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].length <= EN_CAP) continue;
    const slug = (m[0].match(/data-i18n-title="([^"]+)"/) || [])[1] || "(untagged)";
    over.push({ where: `index.html:${lineOf(m.index)} ${slug}`, len: m[1].length, text: m[1] });
  }
  assert.strictEqual(over.length, 0, `${over.length} tooltip(s) over the cap:\n${report(over, EN_CAP)}`);
});

test(`no section note under an <h2> is longer than ${EN_CAP} characters`, () => {
  const re = /<(small|p)\b([^>]*data-i18n(?:-html)?="([a-z0-9_]*(?:_desc|_intro))"[^>]*)>([\s\S]*?)<\/\1>/g;
  const over = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[4].replace(/\s+/g, " ").trim();
    if (text.length <= EN_CAP) continue;
    over.push({ where: `index.html:${lineOf(m.index)} ${m[3]}`, len: text.length, text });
  }
  assert.strictEqual(over.length, 0, `${over.length} note(s) over the cap:\n${report(over, EN_CAP)}`);
});

// ── the Spanish mirror of those same slugs ──────────────────────────────────

// The ES tables are hand-authored one key per line; parsing them as text keeps
// this test from having to load the app's globals.
function esStrings() {
  const out = {};
  ["js/i18n-strings-es.js", "js/i18n-strings-es-extra.js", "js/i18n-strings-es-rows.js"]
    .forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), "utf8");
      const re = /^\s{2}([a-z0-9_]+):\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'),?\s*$/gm;
      let m;
      while ((m = re.exec(src)) !== null) {
        const raw = m[2];
        out[m[1]] = {
          file: f,
          text: raw.startsWith("'") ? raw.slice(1, -1) : JSON.parse(raw),
        };
      }
    });
  return out;
}

/** Every slug index.html uses for a tooltip or a section note. */
function staticSlugs() {
  const slugs = new Set();
  let m;
  const titles = /data-i18n-title="([^"]+)"/g;
  while ((m = titles.exec(html)) !== null) slugs.add(m[1]);
  const descs = /data-i18n(?:-html)?="([a-z0-9_]*(?:_desc|_intro))"/g;
  while ((m = descs.exec(html)) !== null) slugs.add(m[1]);
  return slugs;
}

test(`no Spanish tooltip or note is longer than ${ES_CAP} characters`, () => {
  const es = esStrings();
  const over = [];
  staticSlugs().forEach((slug) => {
    const hit = es[slug];
    if (!hit || hit.text.length <= ES_CAP) return;
    over.push({ where: `${hit.file} ${slug}`, len: hit.text.length, text: hit.text });
  });
  assert.strictEqual(over.length, 0, `${over.length} ES string(s) over the cap:\n${report(over, ES_CAP)}`);
});

// ── the runtime sentences composed in js/*.js ───────────────────────────────

/**
 * Every tx("english", "slug") pair the shipped js hands to a tooltip, keyed by
 * slug. Same shape as tests/i18n-runtime-coverage.test.cjs's scan, widened to
 * the single-quoted and backtick literals a few callers use.
 */
// Runtime strings that are VISIBLE body copy, not hovers — a panel footnote has
// the whole panel to sit in, so the hover cap does not apply to it.
const NOT_A_TOOLTIP = new Set(["r_spec_foot"]);

function runtimeStrings() {
  const out = {};
  for (const file of fs.readdirSync(path.join(ROOT, "js"))) {
    if (!file.endsWith(".js") || file.startsWith("i18n-strings")) continue;
    const src = fs.readFileSync(path.join(ROOT, "js", file), "utf8");
    const re = /\b(?:tx|T|TX|_[a-zA-Z]+T)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*"([a-z0-9_]+)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (NOT_A_TOOLTIP.has(m[3])) continue;
      out[m[3]] = { where: `js/${file}:${lineOf2(src, m.index)}`, text: m[2] };
    }
  }
  return out;
}
const lineOf2 = (src, idx) => src.slice(0, idx).split("\n").length;

test(`no runtime tooltip sentence is longer than ${RUNTIME_EN_CAP} characters`, () => {
  const rt = runtimeStrings();
  const over = Object.keys(rt)
    .filter((slug) => rt[slug].text.length > RUNTIME_EN_CAP)
    .map((slug) => ({ where: `${rt[slug].where} ${slug}`, len: rt[slug].text.length, text: rt[slug].text }));
  assert.strictEqual(over.length, 0, `${over.length} runtime sentence(s) over the cap:\n${report(over, RUNTIME_EN_CAP)}`);
});

test(`no Spanish runtime sentence is longer than ${RUNTIME_ES_CAP} characters`, () => {
  const es = esStrings();
  const over = Object.keys(runtimeStrings())
    .filter((slug) => es[slug] && es[slug].text.length > RUNTIME_ES_CAP)
    .map((slug) => ({ where: `${es[slug].file} ${slug}`, len: es[slug].text.length, text: es[slug].text }));
  assert.strictEqual(over.length, 0, `${over.length} ES runtime sentence(s) over the cap:\n${report(over, RUNTIME_ES_CAP)}`);
});

// A shortened English with a still-enormous Spanish is the failure mode this
// pass was cleaning up — the two must stay roughly in step.
test("no Spanish string is more than twice its English", () => {
  const es = esStrings();
  const en = {};
  let m;
  const re = /<[a-zA-Z][^>]*?title="([^"]*)"[^>]*data-i18n-title="([^"]+)"[^>]*>/g;
  while ((m = re.exec(html)) !== null) en[m[2]] = m[1];
  const rt = runtimeStrings();
  Object.keys(rt).forEach((slug) => { en[slug] = rt[slug].text; });
  const over = Object.keys(en)
    .filter((slug) => es[slug] && en[slug].length > 40 && es[slug].text.length > en[slug].length * 2)
    .map((slug) => ({ where: `${es[slug].file} ${slug}`, len: es[slug].text.length, text: es[slug].text }));
  assert.strictEqual(over.length, 0, `${over.length} ES string(s) far longer than the EN:\n${report(over, "2× EN")}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
