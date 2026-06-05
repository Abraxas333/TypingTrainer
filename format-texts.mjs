#!/usr/bin/env node
// Normalizes the practice texts in public/texts and rebuilds index.json.
//
// Usage:
//   node format-texts.mjs            # dry run: shows what WOULD change
//   node format-texts.mjs --write    # actually rewrite the files + index.json
//   node format-texts.mjs some/dir --write
//
// What it does to each .txt:
//   - strips a leading BOM
//   - normalizes CRLF / CR line endings to LF
//   - expands leading tabs to spaces (TAB_WIDTH), collapses inline tabs to one space
//   - strips trailing whitespace on every line
//   - collapses 3+ blank lines to 1, and trims blank lines at start/end of file
// It also regenerates index.json from the .txt files actually present, so the
// menu can never drift out of sync with the folder again.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const TAB_WIDTH = 4;
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const DIR = args.find((a) => !a.startsWith("--")) ?? "public/texts";

function formatText(text) {
  text = text.replace(/^\uFEFF/, "");          // BOM
  text = text.replace(/\r\n?/g, "\n");          // line endings -> LF

  text = text
    .split("\n")
    .map((line) => {
      const indent = (line.match(/^[ \t]*/) ?? [""])[0];
      const expandedIndent = indent.replace(/\t/g, " ".repeat(TAB_WIDTH));
      const rest = line.slice(indent.length).replace(/\t/g, " "); // inline tab -> 1 space
      return (expandedIndent + rest).replace(/[ \t]+$/, "");      // strip trailing ws
    })
    .join("\n");

  text = text
    .replace(/\n{3,}/g, "\n\n")  // collapse big gaps
    .replace(/^\n+/, "")          // trim leading blank lines
    .replace(/\n+$/, "");         // trim trailing blank lines

  return text;
}

const txtFiles = readdirSync(DIR)
  .filter((f) => extname(f).toLowerCase() === ".txt")
  .sort((a, b) => a.localeCompare(b));

if (txtFiles.length === 0) {
  console.error(`No .txt files found in ${DIR}`);
  process.exit(1);
}

let changed = 0;
for (const file of txtFiles) {
  const path = join(DIR, file);
  const original = readFileSync(path, "utf8");
  const formatted = formatText(original);

  if (formatted === original) {
    console.log(`  ok        ${file}`);
    continue;
  }

  changed++;
  if (WRITE) {
    writeFileSync(path, formatted, "utf8");
    console.log(`  formatted ${file}  (${original.length} -> ${formatted.length} chars)`);
  } else {
    console.log(`  would fmt ${file}  (${original.length} -> ${formatted.length} chars)`);
  }
}

const indexPath = join(DIR, "index.json");
const indexJson = JSON.stringify(txtFiles, null, 2) + "\n";
if (WRITE) {
  writeFileSync(indexPath, indexJson, "utf8");
  console.log(`\nWrote index.json with ${txtFiles.length} entries.`);
  console.log(changed ? `Formatted ${changed} file(s).` : "All files were already clean.");
} else {
  console.log(`\nWould write index.json with ${txtFiles.length} entries:`);
  console.log(txtFiles.map((f) => `  - ${f}`).join("\n"));
  console.log(`\nDry run only. Re-run with --write to apply.`);
}
