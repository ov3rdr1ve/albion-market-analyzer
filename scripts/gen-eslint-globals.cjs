// Lists every top-level declaration in js/*.js: the cross-file globals the
// renderer scripts share (index.html loads them as classic scripts).
// Run: node scripts/gen-eslint-globals.cjs > eslint.globals.json
const fs = require("fs");
const path = require("path");
const espree = require("espree");

const dir = path.join(__dirname, "..", "js");
const names = new Set();
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
  let ast;
  try {
    ast = espree.parse(fs.readFileSync(path.join(dir, f), "utf8"), { ecmaVersion: "latest", sourceType: "script" });
  } catch (e) {
    console.error(`parse failed: ${f}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  const collect = (p) => {
    if (!p) return;
    if (p.type === "Identifier") names.add(p.name);
    else if (p.type === "ObjectPattern") p.properties.forEach((x) => collect(x.value || x.argument));
    else if (p.type === "ArrayPattern") p.elements.forEach(collect);
    else if (p.type === "AssignmentPattern") collect(p.left);
    else if (p.type === "RestElement") collect(p.argument);
  };
  for (const n of ast.body) {
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") names.add(n.id.name);
    else if (n.type === "VariableDeclaration") n.declarations.forEach((d) => collect(d.id));
  }
}
// Names a file publishes with window.X = ... or defineProperty(globalThis, "X") are globals too.
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of src.matchAll(/\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) names.add(m[1]);
  for (const m of src.matchAll(/defineProperty\(\s*(?:window|globalThis)\s*,\s*"([^"]+)"/g)) names.add(m[1]);
}
console.log(JSON.stringify([...names].sort(), null, 1));
