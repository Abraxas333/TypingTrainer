const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app");
}

app.innerHTML = `
  <div id="terminal"></div>
`;

document.body.style.background = "#000";
document.body.style.margin = "0";

const terminal = document.getElementById("terminal")!;

terminal.style.color = "#00ff9c";
terminal.style.fontFamily = "monospace";
terminal.style.padding = "20px";
terminal.style.whiteSpace = "pre-wrap";
terminal.style.fontSize = "18px";

let targetText = "";
let input = "";
let startTime: number | null = null;
let errors = 0;

// ---------- LOAD FILES ----------
async function loadFiles() {
  const res = await fetch("/texts/index.json");
  const files = await res.json();

  await loadFile(files[0]);
}

async function loadFile(name: string) {
  const res = await fetch("/texts/" + name);

  targetText = await res.text();

  reset();
}

// ---------- RESET ----------
function reset() {
  input = "";
  errors = 0;
  startTime = null;

  render();
}

// ---------- RENDER ----------
function render() {
  let html = "";

  for (let i = 0; i < targetText.length; i++) {
    const c = targetText[i];

    if (i < input.length) {
      if (input[i] === c) {
        html += `<span style="color:#22c55e">${escapeHtml(c)}</span>`;
      } else {
        html += `<span style="color:#ef4444">${escapeHtml(c)}</span>`;
      }
    } else if (i === input.length) {
      html += `<span style="background:#2563eb">${escapeHtml(c)}</span>`;
    } else {
      html += escapeHtml(c);
    }
  }

  terminal.innerHTML = html;
}

// ---------- ESCAPE ----------
function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\n/g, "<br>");
}

// ---------- INPUT ----------
window.addEventListener("keydown", (e) => {
  if (!startTime) {
    startTime = Date.now();
  }

  if (e.key === "Backspace") {
    input = input.slice(0, -1);
  } else if (e.key.length === 1) {
    input += e.key;

    if (input[input.length - 1] !== targetText[input.length - 1]) {
      errors++;
    }
  }

  render();
  updateStats();
});

// ---------- STATS ----------
function updateStats() {
  if (!startTime) return;

  const minutes = (Date.now() - startTime) / 60000;

  const wpm =
    Math.round((input.length / 5) / minutes) || 0;

  const acc =
    Math.round(
      ((input.length - errors) / input.length) * 100
    ) || 100;

  document.title =
    `WPM ${wpm} | ACC ${acc}%`;
}

// ---------- START ----------
loadFiles();
