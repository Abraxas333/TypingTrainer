import "xterm/css/xterm.css";

import { Terminal } from "xterm";
import hljs from "highlight.js";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app");
}

// ---------------- TERMINAL ----------------
const term = new Terminal({
  cursorBlink: true,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 18,
  theme: {
    background: "#000000",
    foreground: "#00ff9c",
    cursor: "#ffffff",
  },
});

term.open(app);

// ---------------- STATE ----------------
let targetText = "";
let input = "";
let errors = 0;
let startTime: number | null = null;
let currentFile = "";

// ---------------- LOAD FILES ----------------
async function loadFiles() {
  const res = await fetch("/texts/index.json");
  const files = await res.json();

  if (!files.length) {
    term.writeln("No files found in /public/texts");
    return;
  }

  await loadFile(files[0]);
}

async function loadFile(name: string) {
  currentFile = name;

  const res = await fetch(`/texts/${name}`);

  targetText = await res.text();

  reset();
}

// ---------------- RESET ----------------
function reset() {
  input = "";
  errors = 0;
  startTime = null;

  render();
}

// ---------------- LANGUAGE DETECTION ----------------
function detectLanguage(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "js":
    case "ts":
      return "javascript";

    case "py":
      return "python";

    case "rs":
      return "rust";

    case "cpp":
    case "c":
      return "cpp";

    case "java":
      return "java";

    case "html":
      return "xml";

    case "css":
      return "css";

    case "json":
      return "json";

    case "sh":
      return "bash";

    default:
      return "plaintext";
  }
}

// ---------------- ESCAPE ----------------
function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------- RENDER ----------------

function render() {
  term.clear();

  const lang = detectLanguage(currentFile);

  const highlighted = hljs.highlight(targetText, {
    language: lang,
  }).value;

  const chars = highlighted.split("");

  let out = "";

  let visibleIndex = 0;

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    if (char === "<") {
      while (i < chars.length && chars[i] !== ">") {
        out += chars[i];
        i++;
      }

      out += ">";
      continue;
    }

    const realChar = targetText[visibleIndex];

    if (visibleIndex < input.length) {
      if (input[visibleIndex] === realChar) {
        out += `<span style="color:#22c55e">${escapeHtml(realChar)}</span>`;
      } else {
        out += `<span style="background:#7f1d1d;color:#ffffff">${escapeHtml(realChar)}</span>`;
      }
    } else if (visibleIndex === input.length) {
      out += `<span style="background:#2563eb;color:white">${escapeHtml(realChar)}</span>`;
    } else {
      out += escapeHtml(realChar);
    }

    visibleIndex++;
  }

  term.write(out.replace(/<br>/g, "\r\n"));

  updateStats();
}

// ---------------- STATS ----------------
function updateStats() {
  if (!startTime) return;

  const minutes = (Date.now() - startTime) / 60000;

  const wpm = Math.round(input.length / 5 / minutes) || 0;

  const acc = Math.round(((input.length - errors) / input.length) * 100) || 100;

  document.title = `⌨ ${currentFile} | WPM ${wpm} | ACC ${acc}%`;

  localStorage.setItem(
    "typing_stats",
    JSON.stringify({
      wpm,
      acc,
      errors,
      file: currentFile,
    }),
  );
}

// ---------------- ERROR HEATMAP ----------------
const errorMap: Record<string, number> = {};

function trackError(char: string) {
  errorMap[char] = (errorMap[char] || 0) + 1;
}

// ---------------- INPUT ----------------
window.addEventListener("keydown", (e) => {
  if (!targetText) return;

  if (!startTime) {
    startTime = Date.now();
  }

  if (e.key === "Backspace") {
    input = input.slice(0, -1);
  } else if (e.key.length === 1 || e.key === "Enter") {
    const key = e.key === "Enter" ? "\n" : e.key;

    input += key;

    if (input[input.length - 1] !== targetText[input.length - 1]) {
      errors++;
      trackError(key);
      playKeySound(false);
    } else {
      playKeySound(true);
    }
  }

  render();

  if (input === targetText) {
    term.writeln("\r\n\r\n✔ Finished");
    console.log("Error heatmap:", errorMap);
  }
});

// ---------------- SOUND ----------------
const audioCtx = new AudioContext();

function playKeySound(success: boolean) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.frequency.value = success ? 700 : 200;

  gain.gain.value = 0.01;

  osc.start();
  osc.stop(audioCtx.currentTime + 0.03);
}

// ---------------- START ----------------
loadFiles();
