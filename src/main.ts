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
let everWrong: boolean[] = [];

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
  
  // FIX 1: Höhe des Terminals an den Text anpassen (+ 15 Zeilen Platz für die Stats am Ende)
  // Das verhindert das interne Scrollen von xterm.js komplett!
  const lineCount = targetText.split("\n").length;
  term.resize(term.cols || 120, lineCount + 15);
  
  reset();
}

// ---------------- RESET ----------------
function reset() {
  input = "";
  errors = 0;
  startTime = null;
  everWrong = [];
  render();
}

// ---------------- RENDER (TrueColor ANSI & Custom Cursor) ----------------
function render() {
  // FIX 2: term.clear() ENTFERNT, da es das Terminal zum Scrollen/Springen zwingt.
  // Wir bewegen stattdessen nur den Cursor nach oben links (0,0) und überschreiben den Text.
  let output = "\x1b[H";

  for (let i = 0; i < targetText.length; i++) {
    const expectedChar = targetText[i];
    const typedChar = input[i];
    const isCursor = i === input.length;

    let prefix = "";
    const suffix = "\x1b[0m";
    let displayChar = expectedChar;

    // 1. Cursor Position
    if (isCursor) {
      prefix = "\x1b[48;2;204;255;204m\x1b[38;2;11;15;12m"; // Blasses Grün Hintergrund
      if (expectedChar === "\n") {
        displayChar = " \r\n";
      }
    }
    // 2. Bereits getippter Text
    else {
      if (typedChar == null) {
        // Noch nicht getippt -> Grau (#666666)
        prefix = "\x1b[38;2;102;102;102m";
        if (expectedChar === "\n") displayChar = "\r\n";
      } else if (typedChar === expectedChar) {
        // RICHTIG getippt
        if (everWrong[i]) {
          prefix = "\x1b[38;2;255;255;51m"; // Goldgelb, wenn es korrigiert wurde!
        } else {
          prefix = "\x1b[38;2;0;255;102m"; // Grün, wenn es direkt richtig war
        }
        if (expectedChar === "\n") displayChar = "\r\n";
      } else {
        // FALSCH getippt
        if (expectedChar === "\n") {
          prefix = "\x1b[48;2;255;51;51m\x1b[38;2;255;255;255m";
          displayChar = typedChar === "\n" ? " " : typedChar;
          displayChar += "\x1b[0m\r\n";
        } else {
          // Normales Zeichen erwartet
          prefix = "\x1b[38;2;255;51;51m"; // Roter Text
          if (typedChar === "\n") {
            prefix = "\x1b[48;2;255;51;51m"; // Roter Hintergrund für falsches Enter
            
            // FIX 3: HIER IST DER GRUND FÜR DEIN ZERSCHOSSENES LAYOUT!
            // Hier stand vorher " \r\n". Das hat einen echten Zeilenumbruch erzeugt, wo keiner hingehört.
            displayChar = " "; 
            
          } else if (typedChar === " ") {
            prefix = "\x1b[48;2;255;51;51m"; // Roter Hintergrund für falsches Space
            displayChar = " ";
          } else {
            // DAS TATSÄCHLICH GETIPPTE ZEICHEN ANZEIGEN!
            displayChar = typedChar;
          }
        }
      }
    }

    output += prefix + displayChar + suffix;
  }

  // FIX 4: "\x1b[J" löscht nach dem Schreiben alle "Geisterzeichen" vom Rest des Bildschirms.
  output += "\x1b[J";

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

    if (input.length === targetText.length && input === targetText) return;

    if (!startTime) {
      startTime = Date.now();
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (
      e.key.length > 1 &&
      e.key !== "Backspace" &&
      e.key !== "Enter" &&
      e.key !== "Tab"
    )
      return;

    if (e.key === " " || e.key === "Backspace" || e.key === "Tab") {
      e.preventDefault();
    }

    if (e.key === "Backspace") {
      input = input.slice(0, -1);
    } else if (e.key === "Tab") {
      if (targetText[input.length] === " ") {
        let spacesAdded = 0;
        while (targetText[input.length] === " " && spacesAdded < 4) {
          input += " ";
          spacesAdded++;
        }
        playKeySound(true);
      } else {
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

      const expectedChar = targetText[currentIndex];

      input += key;

      if (input[currentIndex] !== expectedChar) {
        errors++;
        everWrong[currentIndex] = true;
        trackError(expectedChar);
        playKeySound(false);
      } else {
        playKeySound(true);
      }
    }

    render();

    // WENN FERTIG: STATS DIREKT IM TERMINAL DRUCKEN
    if (input === targetText) {
      const minutes = (Date.now() - startTime) / 60000;
      const wpm = Math.round(targetText.length / 5 / minutes) || 0;
      const acc =
        Math.round(((targetText.length - errors) / targetText.length) * 100) ||
        100;

      const sortedErrors = Object.entries(errorMap).sort((a, b) => b[1] - a[1]);
      let errorOutput = "";

      if (sortedErrors.length === 0) {
        errorOutput = "  \x1b[38;2;0;255;102mPerfekt! Keine Fehler.\x1b[0m\r\n";
      } else {
        for (const [char, count] of sortedErrors) {
          const displayChar =
            char === "\n"
              ? "Enter"
              : char === " "
                ? "Space"
                : char === "\t"
                  ? "Tab"
                  : char;
          errorOutput += `  \x1b[38;2;255;51;51m${displayChar}\x1b[0m: ${count}x\r\n`;
        }
      }

      term.write(`\r\n\r\n\x1b[38;2;0;255;102m✔ Finished!\x1b[0m\r\n`);
      term.write(`\x1b[38;2;102;153;255m📊 Stats:\x1b[0m\r\n`);
      term.write(`  WPM: \x1b[38;2;255;255;255m${wpm}\x1b[0m\r\n`);
      term.write(`  ACC: \x1b[38;2;255;255;255m${acc}%\x1b[0m\r\n`);
      term.write(`  Errors: \x1b[38;2;255;51;51m${errors}\x1b[0m\r\n\r\n`);
      term.write(
        `\x1b[38;2;255;255;51m🔥 Error Heatmap (Am häufigsten verfehlt):\x1b[0m\r\n`,
      );
      term.write(errorOutput);
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
