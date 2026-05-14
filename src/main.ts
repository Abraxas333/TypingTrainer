import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import "./styles.css";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app");
}

// ---------------- TERMINAL ----------------
const term = new Terminal({
  cursorBlink: false, // Wir rendern unseren eigenen Block-Cursor
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 18,
  disableStdin: true,
  theme: {
    background: "#0b0f0c", // Dein Black aus der Lua Tabelle
  },
});

term.open(app);

// ---------------- STATE ----------------
let targetText = "";
let input = "";
let errors = 0;
let startTime: number | null = null;
let currentFile = "";
let everWrong: boolean[] = []; // Speichert alle Indizes, die jemals falsch getippt wurden

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
  targetText = (await res.text()).replace(/\r\n/g, "\n");
  reset();
}

// ---------------- RESET ----------------
function reset() {
  input = "";
  errors = 0;
  startTime = null;
  everWrong = []; // Fehler-Historie für neuen Text zurücksetzen
  render();
}

// ---------------- RENDER (TrueColor ANSI & Custom Cursor) ----------------
function render() {
  term.clear();
  term.write("\x1b[H");

  let output = "";

  for (let i = 0; i < targetText.length; i++) {
    const expectedChar = targetText[i];
    const typedChar = input[i];
    const isCursor = i === input.length;

    let prefix = "";
    const suffix = "\x1b[0m";
    let displayChar = expectedChar;

    // 1. Cursor Position
    if (isCursor) {
      // Blasses Grün (#ccffcc) als Hintergrund, dunkles Schwarz (#0b0f0c) als Text
      prefix = "\x1b[48;2;204;255;204m\x1b[38;2;11;15;12m";
      if (expectedChar === "\n") {
        displayChar = " \r\n"; // Block anzeigen, bevor umgebrochen wird
      }
    }
    // 2. Bereits getippter Text
    else {
      if (typedChar == null) {
        // Noch nicht getippt -> Grau (#666666)
        prefix = "\x1b[38;2;102;102;102m";
        if (expectedChar === "\n") displayChar = "\r\n";
      } else if (typedChar === expectedChar) {
        // Richtig getippt
        if (everWrong[i]) {
          // Wurde vorher falsch getippt -> Goldgelb (#ffff33)
          prefix = "\x1b[38;2;255;255;51m";
        } else {
          // Direkt richtig -> Grün (#00FF66)
          prefix = "\x1b[38;2;0;255;102m";
        }
        if (expectedChar === "\n") displayChar = "\r\n";
      } else {
        // Falsch getippt -> Rot (#ff3333)
        if (expectedChar === "\n") {
          prefix = "\x1b[48;2;255;51;51m"; // Roter Block für falschen Umbruch
          displayChar = " \r\n";
        } else {
          prefix = "\x1b[38;2;255;51;51m"; // Roter Text
        }
      }
    }

    output += prefix + displayChar + suffix;
  }

  term.write(output);
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
window.addEventListener(
  "keydown",
  (e) => {
    if (!targetText) return;

    if (!startTime) {
      startTime = Date.now();
    }

    // System-Shortcuts ignorieren
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (
      e.key.length > 1 &&
      e.key !== "Backspace" &&
      e.key !== "Enter" &&
      e.key !== "Tab"
    ) {
      return;
    }

    if (e.key === " " || e.key === "Backspace" || e.key === "Tab") {
      e.preventDefault();
    }

    if (e.key === "Backspace") {
      input = input.slice(0, -1);
    } else if (e.key === "Tab") {
      // SMART TAB: Wenn das nächste Zeichen ein Leerzeichen ist, fülle bis zu 4 Spaces auf einmal auf!
      if (targetText[input.length] === " ") {
        let spacesAdded = 0;
        while (targetText[input.length] === " " && spacesAdded < 4) {
          input += " ";
          spacesAdded++;
        }
        playKeySound(true);
      } else {
        // Tab gedrückt, obwohl kein Leerzeichen erwartet wird -> Fehler!
        const currentIndex = input.length;
        input += "\t";
        errors++;
        everWrong[currentIndex] = true;
        trackError("Tab");
        playKeySound(false);
      }
    } else if (e.key.length === 1 || e.key === "Enter") {
      const key = e.key === "Enter" ? "\n" : e.key;
      const currentIndex = input.length;

      input += key;

      if (input[currentIndex] !== targetText[currentIndex]) {
        errors++;
        everWrong[currentIndex] = true;
        trackError(key);
        playKeySound(false);
      } else {
        playKeySound(true);
      }
    }

    render();

    if (input === targetText) {
      term.write("\r\n\r\n\x1b[38;2;0;255;102m✔ Finished\x1b[0m\r\n");
      console.log("Error heatmap:", errorMap);
    }
  },
  true,
);

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
