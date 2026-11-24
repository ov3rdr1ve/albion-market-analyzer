/**
 * My Crafting List — arithmetic in the Qty box.
 *
 * A quantity is a plan, and a plan arrives as arithmetic: "two runs of 96" is
 * typed `96+96`, a third of a stack as `96/3`. The field used to be an
 * `<input type="number">`, which hands the page back an empty string for any of
 * that, so `normalizeCraftQty` (js/craft-list-store.js) read it as unreadable
 * and snapped the row to 1.
 *
 * This is the whole calculator: a hand-written tokenizer over `+ - * / ( )` and
 * a recursive-descent parser. Deliberately NOT eval() or new Function() — the
 * quantity box is user text, and there is no such call anywhere in js/.
 *
 * `null` is the important half of the contract: it means "not a complete
 * expression", and every caller falls back to what it did before rather than
 * guessing at a number. A half-typed `96+` is exactly that case.
 */

/**
 * Longest text the parser will look at. A quantity is a small sum, not a
 * spreadsheet formula — this is a guard on pathological input, not a shorter
 * grammar, so anything up to it parses normally.
 */
const QTY_EXPR_MAX_LENGTH = 64;

/** Everything the grammar can contain. Anything else rejects the whole text. */
const QTY_EXPR_ALLOWED = /^[0-9.+\-*/() \t]*$/;

/** The operators and brackets, for isQtyExpression. */
const QTY_EXPR_OPERATORS = "+-*/()";

/**
 * Is the user mid-arithmetic?
 *
 * The panel commits a plain number on every keystroke, which is what makes the
 * totals track a typed digit. An expression cannot work that way: `96+` is not
 * a number, and committing the `96` before it would silently drop the second
 * stack the moment the user tabbed away. So a text that carries an operator is
 * held until Enter or blur.
 *
 * A LEADING sign is not an operator here — `-5` is one whole number, and it
 * commits live like any other (the store clamps it to a parked 0).
 */
function isQtyExpression(text) {
  if (typeof text !== "string") return false;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    // A sign in front of the whole text is part of the number, not arithmetic.
    if (i === 0 && (s[i] === "+" || s[i] === "-")) continue;
    if (QTY_EXPR_OPERATORS.indexOf(s[i]) !== -1) return true;
  }
  return false;
}

/**
 * Evaluate one quantity expression.
 *
 * @param {string} text
 * @returns {number|null} the value, or null when the text is not a complete
 *   expression. Nothing is clamped, floored or capped here — that is the
 *   store's job (a negative parks the row, a fraction floors), and this
 *   function's answer is only "what does the text say".
 */
function parseQtyExpression(text) {
  if (typeof text !== "string") return null;
  const src = text.trim();
  if (!src) return null;
  if (src.length > QTY_EXPR_MAX_LENGTH) return null;
  if (!QTY_EXPR_ALLOWED.test(src)) return null;

  let at = 0;

  const skipSpace = () => {
    while (at < src.length && (src[at] === " " || src[at] === "\t")) at++;
  };
  const peek = () => {
    skipSpace();
    return at < src.length ? src[at] : "";
  };

  // A number is digits, optionally a `.` with at least one digit after it.
  // `96.` and `.5` are both rejected: a quantity typed halfway is not a
  // quantity, and guessing which half was meant is how a plan goes wrong.
  const parseNumber = () => {
    const start = at;
    while (at < src.length && src[at] >= "0" && src[at] <= "9") at++;
    const intDigits = at - start;
    let fracDigits = 0;
    if (src[at] === ".") {
      at++;
      const fracStart = at;
      while (at < src.length && src[at] >= "0" && src[at] <= "9") at++;
      fracDigits = at - fracStart;
      if (fracDigits === 0) return null;
    }
    if (intDigits === 0 && fracDigits === 0) return null;
    const n = Number(src.slice(start, at));
    return Number.isFinite(n) ? n : null;
  };

  // factor := ('+'|'-')? ( number | '(' expr ')' )
  //
  // `allowSign` is false directly after a `+` or `-`, so `96++96` is the typo it
  // looks like rather than 96 plus positive 96. It stays true after `*` and `/`,
  // where `2*-3` is ordinary arithmetic and not a doubled operator.
  const parseFactor = (allowSign) => {
    const c = peek();
    if (c === "+" || c === "-") {
      if (!allowSign) return null;
      at++;
      const inner = parseFactor(true);
      if (inner === null) return null;
      return c === "-" ? -inner : inner;
    }
    if (c === "(") {
      at++;
      const inner = parseExpr();
      if (inner === null) return null;
      if (peek() !== ")") return null;
      at++;
      return inner;
    }
    if (c === "") return null;
    return parseNumber();
  };

  // term := factor (('*'|'/') factor)*
  const parseTerm = (allowSign) => {
    let left = parseFactor(allowSign);
    if (left === null) return null;
    for (;;) {
      const op = peek();
      if (op !== "*" && op !== "/") return left;
      at++;
      const right = parseFactor(true);
      if (right === null) return null;
      left = op === "*" ? left * right : left / right;
    }
  };

  // expr := term (('+'|'-') term)*
  const parseExpr = () => {
    let left = parseTerm(true);
    if (left === null) return null;
    for (;;) {
      const op = peek();
      if (op !== "+" && op !== "-") return left;
      at++;
      const right = parseTerm(false);
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
  };

  const value = parseExpr();
  if (value === null) return null;
  // Trailing junk means the text was never one expression: `96 96` is two
  // quantities, and picking the first one is picking for the user.
  if (peek() !== "") return null;
  // 1/0 lands here as Infinity, 0/0 as NaN. Neither is a quantity.
  return Number.isFinite(value) ? value : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    QTY_EXPR_MAX_LENGTH,
    isQtyExpression,
    parseQtyExpression,
  };
}
