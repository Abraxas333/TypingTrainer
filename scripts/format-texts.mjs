#!/usr/bin/env node
// scripts/format-texts.mjs
//
// Normalizes the practice text files in public/texts/ and regenerates
// public/texts/index.json so the menu can never drift from what's on disk.
//
// For every *.txt it:
//   - strips a leading UTF-8 BOM
//   - converts CRLF / CR line endings to LF
//   - expands tabs to spaces (TAB_WIDTH) so the typing engine's string
//     index and xterm's column index stay in sync (a raw \t is one string
//     char but renders as several columns, which desyncs the cursor)
//   - strips trailing whitespace from every line
//   - collapses runs of 3+ blank lines down to a single blank line
//   - trims blank lines from the start and end of the file
//
// Run with:  npm run format:texts

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TAB_WIDTH = 4;
const HERE = dirname(fileURLToPath(import.meta.url));
const TEXTS_DIR = join(HERE, "..", "public", "texts");

// Files that live in the folder but should NOT appear in the menu.
const IGNORE = new Set(["example.txt"]);

function normalize(raw) {
  let text = raw.replace(/^\uFEFF/, "");                 // BOM
  text = text.replace(/\r\n?/g, "\n");                   // CRLF / CR -> LF
  text = text.replace(/\t/g, " ".repeat(TAB_WIDTH));     // tabs -> spaces

  // strip trailing whitespace per line
  const lines = text.split("\n").map((line) => line.replace(/[ \t]+$/g, ""));

  // collapse 3+ consecutive blank lines into a single blank line
  const collapsed = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line === "") {
      blankRun += 1;
      if (blankRun <= 1) collapsed.push(line);
    } else {
      blankRun = 0;
      collapsed.push(line);
    }
  }

  // trim blank lines from both ends
  while (collapsed.length && collapsed[0] === "") collapsed.shift();
  while (collapsed.length && collapsed.at(-1) === "") collapsed.pop();

  return collapsed.join("\n");
}

async function main() {
  const entries = await readdir(TEXTS_DIR);
  const txtFiles = entries
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .sort();

  let changed = 0;
  for (const file of txtFiles) {
    const path = join(TEXTS_DIR, file);
    const before = await readFile(path, "utf8");
    const after = normalize(before);
    if (after !== before) {
      await writeFile(path, after, "utf8");
      changed += 1;
      console.log(`formatted  ${file}`);
    } else {
      console.log(`unchanged  ${file}`);
    }
  }

  const menu = txtFiles.filter((f) => !IGNORE.has(f));
  await writeFile(
    join(TEXTS_DIR, "index.json"),
    JSON.stringify(menu, null, 2) + "\n",
    "utf8",
  );

  console.log(
    `\n${changed} file(s) reformatted, ${menu.length} listed in index.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
