#!/usr/bin/env node
/**
 * Copy exceljs and its transitive dependencies into standalone node_modules.
 * Usage: node scripts/copy-module-tree.js <srcNodeModules> <destNodeModules> exceljs
 */
const fs = require("node:fs");
const path = require("node:path");

const [srcRoot, destRoot, ...roots] = process.argv.slice(2);
if (!srcRoot || !destRoot || roots.length === 0) {
  console.error(
    "Usage: copy-module-tree.js <srcNodeModules> <destNodeModules> <pkg>...",
  );
  process.exit(1);
}

const pending = [...roots];
const seen = new Set();

function pkgDir(root, name) {
  return path.join(root, ...name.split("/"));
}

function readDeps(dir) {
  const pkgFile = path.join(dir, "package.json");
  if (!fs.existsSync(pkgFile)) return [];
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  return Object.keys(pkg.dependencies ?? {});
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

while (pending.length) {
  const name = pending.pop();
  if (seen.has(name)) continue;
  seen.add(name);
  const from = pkgDir(srcRoot, name);
  if (!fs.existsSync(from)) {
    console.warn(`skip missing ${name}`);
    continue;
  }
  const to = pkgDir(destRoot, name);
  if (!fs.existsSync(to)) {
    copyDir(from, to);
  }
  for (const dep of readDeps(from)) {
    if (!seen.has(dep)) pending.push(dep);
  }
  // also nested node_modules inside the package
  const nested = path.join(from, "node_modules");
  if (fs.existsSync(nested)) {
    for (const entry of fs.readdirSync(nested)) {
      if (entry.startsWith("@")) {
        for (const scoped of fs.readdirSync(path.join(nested, entry))) {
          const n = `${entry}/${scoped}`;
          if (!seen.has(n)) pending.push(n);
        }
      } else if (!seen.has(entry)) {
        pending.push(entry);
      }
    }
  }
}

console.log(`copied ${seen.size} packages for: ${roots.join(", ")}`);
