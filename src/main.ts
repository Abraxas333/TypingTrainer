import "xterm/css/xterm.css";
import { Terminal } from "xterm";
import "./styles.css";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app");
}

// ---------------- TERMINAL SETUP ----------------
const term = new Terminal({
  cursorBlink: false,
  fontFamily: "JetBrains Mono, monospace",
  fontSize: 18,
  disableStdin: true,
  theme: {
    background: "#0b0f0c",
  },
});

term.open(app);

// ---------------- STATE ----------------
type AppMode = "MENU" | "TYPING" | "FINISHED";

let mode: AppMode = "MENU";
let fileList: string[] = [];
let selectedMenuIndex = 0;

let targetText = "";
let input = "";
let errors = 0;
let startTime: number | null = null;
let currentFile = "";
let everWrong: boolean[] = [];
let errorMap: Record<string, number> = {};

// ---------------- AUDIO SYSTEM ----------------
const audioCtx = new AudioContext();

function playKeySound(success: boolean) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.frequency.value = success ? 700 : 200;
  gain.gain.value = 0.05;

  osc.start();
  osc.stop(audioCtx.currentTime + 0.03);
}

// ---------------- TEXT FORMATTING ----------------
function wrapText(text: string, maxLen: number = 80): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let line of lines) {
    if (line.length <= maxLen) {
      result.push(line);
      continue;
    }

    const indentMatch = line.match(/^\s*/);
    const indent = indentMatch ? indentMatch[0] : '';

    while (line.length > maxLen) {
      let breakPoint = line.lastIndexOf(' ', maxLen);
      
      if (breakPoint <= indent.length) {
        breakPoint = maxLen;
      }

      result.push(line.substring(0, breakPoint));
      line = indent + line.substring(breakPoint).trimStart();
    }
    
    if (line) {
      result.push(line);
    }
  }

  return result.join('\n');
}

// ---------------- INIT & MENU ----------------
async function loadFiles() {
  try {
    const res = await fetch("/texts/index.json");
    fileList = await res.json();

    if (!fileList.length) {
      term.writeln("No files found in /texts/index.json");
      return;
    }

    mode = "MENU";
    renderMenu();
  } catch (err) {
    term.writeln("\x1b[31mFailed to load /texts/index.json\x1b[0m");
  }
}

function renderMenu() {
  term.resize(85, Math.max(15, fileList.length + 8));
  term.clear();
  let output = "\x1b[H"; 

  output += "\x1b[38;2;102;153;255m=== TERMINAL TYPING TEST ===\x1b[0m\r\n";
  output += "\x1b[38;2;102;102;102mNutze UP/DOWN um zu navigieren, ENTER um zu starten.\x1b[0m\r\n\r\n";

  for (let i = 0; i < fileList.length; i++) {
    if (i === selectedMenuIndex) {
      output += `\x1b[48;2;0;255;102m\x1b[38;2;0;0;0m > ${fileList[i]} \x1b[0m\r\n`;
    } else {
      output += `   ${fileList[i]}\r\n`;
    }
  }

  output += "\x1b[J"; 
  term.write(output);
}

// ---------------- LOAD TEXT & TYPING ----------------
async function loadFile(name: string) {
  currentFile = name;
  try {
    const res = await fetch(`/texts/${name}`);
    let rawText = await res.text();
    
    rawText = rawText.replace(/\r\n/g, "\n");
    targetText = wrapText(rawText, 80); // Erzwingt Umbrüche bei 80 Zeichen
    
    const lineCount = targetText.split("\n").length;
    term.resize(85, lineCount + 15); // Breite auf 85 fixiert, Höhe dynamisch
    
    mode = "TYPING";
    resetTypingState();
  } catch (err) {
    term.writeln(`\x1b[31mFailed to load ${name}\x1b[0m`);
  }
}

function resetTypingState() {
  input = "";
  errors = 0;
  startTime = null;
  everWrong = [];
  errorMap = {};
  term.clear();
  renderTyping();
}

function renderTyping() {
  let output = "\x1b[H";

  for (let i = 0; i < targetText.length; i++) {
    const expectedChar = targetText[i];
    const typedChar = input[i];
    const isCursor = i === input.length;

    let prefix = "";
    const suffix = "\x1b[0m";
    let displayChar = expectedChar;

    if (isCursor) {
      prefix = "\x1b[48;2;204;255;204m\x1b[38;2;11;15;12m"; // Cursor
      if (expectedChar === "\n") displayChar = " \r\n";
    } else {
      if (typedChar == null) {
        prefix = "\x1b[38;2;102;102;102m"; // Grau (Ungeschrieben)
        if (expectedChar === "\n") displayChar = "\r\n";
      } else if (typedChar === expectedChar) {
        if (everWrong[i]) {
          prefix = "\x1b[38;2;255;255;51m"; // Gelb (Korrigiert)
        } else {
          prefix = "\x1b[38;2;0;255;102m"; // Grün (Richtig)
        }
        if (expectedChar === "\n") displayChar = "\r\n";
      } else {
        // Rot (Fehler)
        if (expectedChar === "\n") {
          prefix = "\x1b[48;2;255;51;51m\x1b[38;2;255;255;255m";
          displayChar = typedChar === "\n" ? " " : typedChar;
          displayChar += "\x1b[0m\r\n";
        } else {
          prefix = "\x1b[38;2;255;51;51m"; 
          if (typedChar === "\n" || typedChar === " ") {
            prefix = "\x1b[48;2;255;51;51m";
            displayChar = " ";
          } else {
            displayChar = typedChar;
          }
        }
      }
    }

    output += prefix + displayChar + suffix;
  }

  output += "\x1b[J";
  term.write(output);
  updateStats();
}

function updateStats() {
  if (!startTime) return;
  const minutes = (Date.now() - startTime) / 60000;
  const wpm = Math.round(input.length / 5 / minutes) || 0;
  const acc = Math.round(((input.length - errors) / input.length) * 100) || 100;
  document.title = `⌨ ${currentFile} | WPM ${wpm} | ACC ${acc}%`;
}

function trackError(char: string) {
  errorMap[char] = (errorMap[char] || 0) + 1;
}

// ---------------- INPUT ROUTING ----------------
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
    }

    if (mode === "MENU") {
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
      }
      return;
    }

    if (mode === "FINISHED") {
      if (e.key === "Escape") {
        mode = "MENU";
        renderMenu();
      }
      return;
    }

    if (mode === "TYPING") {
      if (e.key === "Escape") {
        mode = "MENU";
        renderMenu();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length > 1 && e.key !== "Backspace" && e.key !== "Enter" && e.key !== "Tab") return;

      if (!startTime && e.key !== "Escape") {
        startTime = Date.now();
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

      renderTyping();

      if (input === targetText) {
        mode = "FINISHED";
        
        const minutes = (Date.now() - startTime!) / 60000;
        const wpm = Math.round(targetText.length / 5 / minutes) || 0;
        const acc = Math.max(0, Math.round(((targetText.length - errors) / targetText.length) * 100));

        const sortedErrors = Object.entries(errorMap).sort((a, b) => b[1] - a[1]);
        let errorOutput = "";

        if (sortedErrors.length === 0) {
          errorOutput = "  \x1b[38;2;0;255;102mPerfekt! Keine Fehler.\x1b[0m\r\n";
        } else {
          for (const [char, count] of sortedErrors) {
            const displayChar = char === "\n" ? "Enter" : char === " " ? "Space" : char === "\t" ? "Tab" : char;
            errorOutput += `  \x1b[38;2;255;51;51m${displayChar}\x1b[0m: ${count}x\r\n`;
          }
        }

        term.write(`\r\n\r\n\x1b[38;2;0;255;102m✔ Test abgeschlossen!\x1b[0m\r\n`);
        term.write(`\x1b[38;2;102;153;255m📊 Statistiken:\x1b[0m\r\n`);
        term.write(`  WPM: \x1b[38;2;255;255;255m${wpm}\x1b[0m\r\n`);
        term.write(`  ACC: \x1b[38;2;255;255;255m${acc}%\x1b[0m\r\n`);
        term.write(`  Errors: \x1b[38;2;255;51;51m${errors}\x1b[0m\r\n\r\n`);
        term.write(`\x1b[38;2;255;255;51m🔥 Error Heatmap (Am häufigsten verfehlt):\x1b[0m\r\n`);
        term.write(errorOutput);
        term.write(`\r\n\x1b[38;2;102;102;102m[ ESC drücken um zum Menü zurückzukehren ]\x1b[0m\r\n`);
      }
    }
  },
  true
);

// ---------------- START ----------------
loadFiles();
