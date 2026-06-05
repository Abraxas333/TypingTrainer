import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import "./styles.css";

// ---------------- CSS SCROLL FIX ----------------
document.body.style.margin = "0";
document.body.style.backgroundColor = "#0b0f0c";
document.body.style.overflowY = "auto";
document.body.style.overflowX = "hidden";

const app = document.getElementById("app");
if (!app) {
  throw new Error("Missing #app");
}
app.style.height = "fit-content";
app.style.minHeight = "100vh";

// ---------------- TERMINAL SETUP ----------------
const term = new Terminal({
  cursorBlink: false,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 18,
  disableStdin: true,
  theme: { background: "#0b0f0c" },
});
term.open(app);
term.write("\x1b[?25l");

// ---------------- I18N ----------------
type Lang = "en" | "de";

const STRINGS = {
  en: {
    layoutTitle: "=== SELECT LANGUAGE ===",
    layoutNav: "Use UP/DOWN to choose, ENTER to confirm.",
    optEn: "English (US keyboard)",
    optDe: "Deutsch (DE-Tastatur)",
    menuTitle: "=== TERMINAL TYPING TEST ===",
    menuNav: "UP/DOWN to navigate, ENTER to start, ESC for language.",
    done: "Test complete!",
    stats: "Statistics:",
    heatmap: "Error heatmap (most missed):",
    perfect: "Perfect! No mistakes.",
    back: "[ Press ESC to return to the menu ]",
    wpm: "WPM",
    acc: "ACC",
    errors: "Errors",
    enter: "Enter",
    space: "Space",
    tab: "Tab",
    loadFail: (n: string) => `Failed to load ${n}`,
    indexFail: "Failed to load /texts/index.json",
    empty: "No files found in /texts/index.json",
  },
  de: {
    layoutTitle: "=== SPRACHE WÄHLEN ===",
    layoutNav: "UP/DOWN zum Wählen, ENTER zum Bestätigen.",
    optEn: "English (US keyboard)",
    optDe: "Deutsch (DE-Tastatur)",
    menuTitle: "=== TERMINAL TYPING TEST ===",
    menuNav: "UP/DOWN zum Navigieren, ENTER zum Starten, ESC für Sprache.",
    done: "Test abgeschlossen!",
    stats: "Statistiken:",
    heatmap: "Error Heatmap (Am häufigsten verfehlt):",
    perfect: "Perfekt! Keine Fehler.",
    back: "[ ESC drücken um zum Menü zurückzukehren ]",
    wpm: "WPM",
    acc: "ACC",
    errors: "Fehler",
    enter: "Enter",
    space: "Leertaste",
    tab: "Tab",
    loadFail: (n: string) => `Konnte ${n} nicht laden`,
    indexFail: "Konnte /texts/index.json nicht laden",
    empty: "Keine Dateien in /texts/index.json gefunden",
  },
} as const;

let lang: Lang = "en";
function t() {
  return STRINGS[lang];
}

// ---------------- STATE ----------------
type AppMode = "LAYOUT" | "MENU" | "TYPING" | "FINISHED";
type CharKind = "content" | "inline" | "indent" | "trailing" | "newline";

let mode: AppMode = "LAYOUT";
let layoutIndex = 0; // 0 = en, 1 = de
let fileList: string[] = [];
let selectedMenuIndex = 0;

let currentFile = "";
let target = "";
let kind: CharKind[] = [];
let status: number[] = []; // 0 pending | 1 correct | 2 wrong | 3 autofilled
let typedChars: (string | null)[] = [];
let everWrong: boolean[] = [];
let cursor = 0;

let errors = 0;
let typedCount = 0;
let correctCount = 0;
let typeableTotal = 0;
let startTime: number | null = null;
let errorMap: Record<string, number> = {};

// ---------------- DYNAMIC LAYOUT ----------------
function getAvailableCols(): number {
  const charWidth = 11; // approx px per cell at fontSize 18
  return Math.max(40, Math.floor(window.innerWidth / charWidth) - 4);
}

// ---------------- AUDIO ----------------
const audioCtx = new AudioContext();
function playKeySound(success: boolean) {
  if (audioCtx.state === "suspended") audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.type = "sine";
  osc.frequency.value = success ? 600 : 200;
  gain.gain.value = 0.05;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
  osc.stop(audioCtx.currentTime + 0.05);
}

// ---------------- TEXT FORMATTING ----------------
function wrapText(text: string, maxLen: number): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (let line of lines) {
    if (line.length <= maxLen) {
      result.push(line);
      continue;
    }
    const indent = (line.match(/^\s*/) ?? [""])[0];
    while (line.length > maxLen) {
      let breakPoint = line.lastIndexOf(" ", maxLen);
      if (breakPoint <= indent.length) breakPoint = maxLen;
      result.push(line.substring(0, breakPoint));
      line = indent + line.substring(breakPoint).trimStart();
    }
    if (line) result.push(line);
  }
  return result.join("\n");
}

// Classify every character so the engine knows what must be typed
// vs. what is "navigation" whitespace it can auto-fill.
function classify(text: string): CharKind[] {
  const k: CharKind[] = new Array(text.length);
  let sawContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") {
      k[i] = "newline";
      sawContent = false;
    } else if (c === " " || c === "\t") {
      if (!sawContent) {
        k[i] = "indent";
      } else {
        // trailing if only whitespace remains before the next newline
        let j = i + 1;
        let contentAhead = false;
        while (j < text.length && text[j] !== "\n") {
          if (text[j] !== " " && text[j] !== "\t") {
            contentAhead = true;
            break;
          }
          j++;
        }
        k[i] = contentAhead ? "inline" : "trailing";
      }
    } else {
      k[i] = "content";
      sawContent = true;
    }
  }
  return k;
}

// ---------------- INIT & MENU ----------------
async function loadFiles() {
  try {
    const res = await fetch("/texts/index.json");
    fileList = await res.json();
    if (!fileList.length) term.writeln(t().empty);
  } catch {
    term.writeln(`\x1b[31m${t().indexFail}\x1b[0m`);
  }
}

function renderLayout() {
  term.resize(getAvailableCols(), 12);
  term.clear();
  let out = "\x1b[H";
  out += `\x1b[38;2;102;153;255m${t().layoutTitle}\x1b[0m\r\n`;
  out += `\x1b[38;2;102;102;102m${t().layoutNav}\x1b[0m\r\n\r\n`;
  const opts = [t().optEn, t().optDe];
  for (let i = 0; i < opts.length; i++) {
    if (i === layoutIndex) {
      out += `\x1b[48;2;0;255;102m\x1b[38;2;0;0;0m > ${opts[i]} \x1b[0m\r\n`;
    } else {
      out += `   ${opts[i]}\r\n`;
    }
  }
  out += "\x1b[J";
  term.write(out);
}

function renderMenu() {
  term.resize(getAvailableCols(), Math.max(15, fileList.length + 8));
  term.clear();
  let out = "\x1b[H";
  out += `\x1b[38;2;102;153;255m${t().menuTitle}\x1b[0m\r\n`;
  out += `\x1b[38;2;102;102;102m${t().menuNav}\x1b[0m\r\n\r\n`;
  for (let i = 0; i < fileList.length; i++) {
    if (i === selectedMenuIndex) {
      out += `\x1b[48;2;0;255;102m\x1b[38;2;0;0;0m > ${fileList[i]} \x1b[0m\r\n`;
    } else {
      out += `   ${fileList[i]}\r\n`;
    }
  }
  out += "\x1b[J";
  term.write(out);
}

// ---------------- LOAD TEXT & TYPING ----------------
async function loadFile(name: string) {
  currentFile = name;
  try {
    const res = await fetch(`/texts/${name}`);
    let raw = await res.text();
    raw = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ");

    const cols = getAvailableCols();
    target = wrapText(raw, cols - 2).replace(/\n+$/, ""); // last char should be content

    kind = classify(target);
    typeableTotal = kind.reduce(
      (n, k) => n + (k === "indent" || k === "trailing" ? 0 : 1),
      0
    );

    const lineCount = target.split("\n").length;
    term.resize(cols, lineCount + 20);

    mode = "TYPING";
    resetTypingState();
  } catch {
    term.writeln(`\x1b[31m${t().loadFail(name)}\x1b[0m`);
  }
}

function autoSkip() {
  while (cursor < target.length && (kind[cursor] === "indent" || kind[cursor] === "trailing")) {
    status[cursor] = 3;
    cursor++;
  }
}

function resetTypingState() {
  status = new Array(target.length).fill(0);
  typedChars = new Array(target.length).fill(null);
  everWrong = new Array(target.length).fill(false);
  cursor = 0;
  errors = 0;
  typedCount = 0;
  correctCount = 0;
  startTime = null;
  errorMap = {};
  autoSkip(); // skip the first line's indentation
  term.write("\x1bc\x1b[?25l");
  renderTyping();
}

function trackError(char: string) {
  errorMap[char] = (errorMap[char] || 0) + 1;
}

// Keep the typing cursor on screen as the text grows past the viewport.
function scrollToActiveLine(lineY: number) {
  const cursorPixels = lineY * 21.6; // ~ fontSize 18 * 1.2 line height
  const windowY = window.scrollY;
  const windowH = window.innerHeight;
  if (cursorPixels > windowY + windowH - 150) {
    window.scrollTo({ top: cursorPixels - windowH + 150 });
  } else if (cursorPixels < windowY + 100) {
    window.scrollTo({ top: Math.max(0, cursorPixels - 100) });
  }
}

function renderTyping() {
  let out = "\x1b[H";
  const reset = "\x1b[0m";

  let cursorX = 1;
  let cursorY = 1;
  let curX = 1;
  let curY = 1;

  for (let i = 0; i < target.length; i++) {
    const ch = target[i];
    const isNL = ch === "\n";
    if (i === cursor) {
      cursorX = curX;
      cursorY = curY;
    }

    if (i === cursor) {
      // cursor cell
      out += `\x1b[48;2;204;255;204m\x1b[38;2;11;15;12m${isNL ? " " : ch}${reset}${isNL ? "\r\n" : ""}`;
    } else {
      const st = status[i];
      if (st === 1) {
        const color = everWrong[i] ? "\x1b[38;2;255;255;51m" : "\x1b[38;2;0;255;102m";
        out += `${color}${isNL ? "" : ch}${reset}${isNL ? "\r\n" : ""}`;
      } else if (st === 2) {
        if (isNL) {
          out += `\x1b[48;2;255;51;51m\x1b[38;2;255;255;255m ${reset}\r\n`;
        } else {
          const tc = typedChars[i];
          if (tc == null || tc === " " || tc === "\t" || tc === "\n") {
            out += `\x1b[48;2;255;51;51m ${reset}`;
          } else {
            out += `\x1b[38;2;255;51;51m${tc}${reset}`;
          }
        }
      } else if (st === 3) {
        // auto-filled indentation: render as plain (dim) whitespace
        out += `\x1b[38;2;102;102;102m${isNL ? "" : ch}${reset}${isNL ? "\r\n" : ""}`;
      } else {
        // pending
        out += `\x1b[38;2;102;102;102m${isNL ? "" : ch}${reset}${isNL ? "\r\n" : ""}`;
      }
    }

    if (isNL) {
      curY++;
      curX = 1;
    } else {
      curX++;
    }
  }

  out += "\x1b[J";
  out += `\x1b[${cursorY};${cursorX}H`; // pin xterm's hidden cursor where we type
  term.write(out);
  updateStats();
  scrollToActiveLine(cursorY);
}

function updateStats() {
  if (!startTime) return;
  const minutes = (Date.now() - startTime) / 60000;
  const wpm = minutes > 0 ? Math.round(typedCount / 5 / minutes) : 0;
  const acc = typedCount > 0 ? Math.round((correctCount / typedCount) * 100) : 100;
  document.title = `⌨ ${currentFile} | ${t().wpm} ${wpm} | ${t().acc} ${acc}%`;
}

function backspace() {
  if (cursor <= 0) return;
  do {
    cursor--;
    status[cursor] = 0;
    typedChars[cursor] = null;
  } while (cursor > 0 && (kind[cursor] === "indent" || kind[cursor] === "trailing"));
  // if we backed onto leading indentation at the very start, re-skip forward
  if (kind[cursor] === "indent" || kind[cursor] === "trailing") autoSkip();
}

function finish() {
  mode = "FINISHED";
  const s = t();
  const minutes = startTime ? (Date.now() - startTime) / 60000 : 0;
  const wpm = minutes > 0 ? Math.round(typeableTotal / 5 / minutes) : 0;
  const acc = typedCount > 0 ? Math.max(0, Math.round((correctCount / typedCount) * 100)) : 100;

  const sorted = Object.entries(errorMap).sort((a, b) => b[1] - a[1]);
  let heat = "";
  if (sorted.length === 0) {
    heat = `  \x1b[38;2;0;255;102m${s.perfect}\x1b[0m\r\n`;
  } else {
    for (const [char, count] of sorted) {
      const name = char === "\n" ? s.enter : char === " " ? s.space : char === "\t" ? s.tab : char;
      heat += `  \x1b[38;2;255;51;51m${name}\x1b[0m: ${count}x\r\n`;
    }
  }

  term.write(`\r\n\r\n\x1b[38;2;0;255;102m✔ ${s.done}\x1b[0m\r\n`);
  term.write(`\x1b[38;2;102;153;255m📊 ${s.stats}\x1b[0m\r\n`);
  term.write(`  ${s.wpm}: \x1b[38;2;255;255;255m${wpm}\x1b[0m\r\n`);
  term.write(`  ${s.acc}: \x1b[38;2;255;255;255m${acc}%\x1b[0m\r\n`);
  term.write(`  ${s.errors}: \x1b[38;2;255;51;51m${errors}\x1b[0m\r\n\r\n`);
  term.write(`\x1b[38;2;255;255;51m🔥 ${s.heatmap}\x1b[0m\r\n`);
  term.write(heat);
  term.write(`\r\n\x1b[38;2;102;102;102m${s.back}\x1b[0m\r\n`);
}

// ---------------- INPUT ROUTING ----------------
function handleLayoutKey(e: KeyboardEvent) {
  if (e.key === "ArrowUp") {
    layoutIndex = Math.max(0, layoutIndex - 1);
    playKeySound(true);
    renderLayout();
  } else if (e.key === "ArrowDown") {
    layoutIndex = Math.min(1, layoutIndex + 1);
    playKeySound(true);
    renderLayout();
  } else if (e.key === "Enter") {
    lang = layoutIndex === 0 ? "en" : "de";
    try {
      localStorage.setItem("lang", lang);
    } catch {
      /* webview storage may be unavailable; ignore */
    }
    playKeySound(true);
    mode = "MENU";
    selectedMenuIndex = 0;
    renderMenu();
  }
}

function handleMenuKey(e: KeyboardEvent) {
  if (e.key === "ArrowUp") {
    selectedMenuIndex = Math.max(0, selectedMenuIndex - 1);
    playKeySound(true);
    renderMenu();
  } else if (e.key === "ArrowDown") {
    selectedMenuIndex = Math.min(fileList.length - 1, selectedMenuIndex + 1);
    playKeySound(true);
    renderMenu();
  } else if (e.key === "Enter") {
    playKeySound(true);
    loadFile(fileList[selectedMenuIndex]);
  } else if (e.key === "Escape") {
    mode = "LAYOUT";
    renderLayout();
  }
}

function handleTypingKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    mode = "MENU";
    renderMenu();
    return;
  }

  // Allow AltGr (reported as Ctrl+Alt on Windows/Linux) so DE-layout users can
  // type { } [ ] @ \ ~ | etc. Block only "real" modifier chords.
  const altGr = e.getModifierState && e.getModifierState("AltGraph");
  if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;

  if (cursor >= target.length) return;

  if (e.key === "Backspace") {
    backspace();
    renderTyping();
    return;
  }

  const k = kind[cursor];

  // --- line jump: Enter / Space / Tab all advance to the next line ---
  if (k === "newline") {
    if (e.key === "Enter" || e.key === " " || e.code === "Tab") {
      if (!startTime) startTime = Date.now();
      status[cursor] = 1;
      cursor++;
      autoSkip();
      typedCount++;
      correctCount++;
      playKeySound(true);
      renderTyping();
      if (cursor >= target.length) finish();
    } else if (e.key.length === 1) {
      // typed a character where the line should end -> wrong, but don't advance
      if (!startTime) startTime = Date.now();
      errors++;
      typedCount++;
      trackError("\n");
      playKeySound(false);
    }
    return;
  }

  // --- content / interior space ---
  // Structural keys mid-line do nothing (no penalty): indentation is auto-filled,
  // so Enter/Tab here would only be a mistaken jump.
  if (e.key === "Enter" || e.code === "Tab") return;
  if (e.key.length !== 1) return;

  if (!startTime) startTime = Date.now();
  const expected = target[cursor];
  typedCount++;
  if (e.key === expected) {
    status[cursor] = 1;
    correctCount++;
    playKeySound(true);
  } else {
    status[cursor] = 2;
    typedChars[cursor] = e.key;
    everWrong[cursor] = true;
    errors++;
    trackError(expected);
    playKeySound(false);
  }
  cursor++;
  autoSkip();
  renderTyping();
  if (cursor >= target.length) finish();
}

window.addEventListener(
  "keydown",
  (e) => {
    const block = [
      " ", "Tab", "Enter", "Backspace",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "PageUp", "PageDown", "Home", "End",
    ];
    if (block.includes(e.key) || e.code === "Space" || e.code === "Tab") {
      e.preventDefault();
    }

    if (mode === "LAYOUT") return handleLayoutKey(e);
    if (mode === "MENU") return handleMenuKey(e);
    if (mode === "FINISHED") {
      if (e.key === "Escape") {
        mode = "MENU";
        renderMenu();
      }
      return;
    }
    if (mode === "TYPING") return handleTypingKey(e);
  },
  true
);

window.addEventListener("resize", () => {
  if (mode === "LAYOUT") renderLayout();
  else if (mode === "MENU") renderMenu();
});

// ---------------- START ----------------
async function start() {
  await loadFiles();
  const saved = localStorage.getItem("lang");
  if (saved === "en" || saved === "de") {
    lang = saved;
    layoutIndex = saved === "en" ? 0 : 1;
  }
  mode = "LAYOUT";
  renderLayout();
}

start();
