# Typing Terminal

A terminal-styled touch-typing trainer for **code**, built with [Tauri](https://tauri.app/), TypeScript, Vite, and [xterm.js](https://xtermjs.org/). It loads plain-text snippets (the included examples are C standard-library exercises), renders them in a terminal-like view, and scores your speed and accuracy as you retype them.

## Features

- **Code-aware whitespace handling.** Leading indentation is filled in for you automatically and never penalized, so it doesn't matter whether a snippet was written with tabs or spaces. You only type the visible characters.
- **Lenient line jumps.** At the end of a line, **Enter**, **Space**, or **Tab** all advance to the next line. Interior spaces (between tokens) *are* evaluated, because they're real content.
- **Language selection at startup** — English or Deutsch. The whole UI switches with it, and the choice is remembered between sessions.
- **Full keyboard-layout support**, including AltGr characters (`{ } [ ] @ \ ~ |`) so German-layout users can type C code without trouble.
- **Live stats**: words-per-minute and accuracy update in the title bar as you type.
- **End-of-run summary** with WPM, accuracy, total errors, and an error heatmap showing which characters you miss most.
- Audio key feedback (distinct tones for correct vs. incorrect keystrokes).

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended) — for the frontend and tooling.
- [Rust toolchain](https://www.rust-lang.org/tools/install) (`rustup`) — required by Tauri for the desktop build.
- Platform-specific Tauri system dependencies — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

## Setup

Install all frontend dependencies (this reads `package.json` and pulls everything automatically):

```bash
npm install
```

Rust/Cargo dependencies are resolved automatically by Cargo the first time you run a Tauri command — no separate step needed.

## Running

Run the full desktop app (recommended):

```bash
npm run tauri dev
```

Or run just the web frontend in a browser (no Tauri shell):

```bash
npm run dev
```

Build a production desktop bundle:

```bash
npm run tauri build
```

## Controls

| Context        | Keys                                                        |
| -------------- | ----------------------------------------------------------- |
| Language screen| `↑` / `↓` to choose, `Enter` to confirm                     |
| Menu           | `↑` / `↓` to navigate, `Enter` to start, `Esc` for language |
| Typing         | Type the text; `Enter`/`Space`/`Tab` to jump lines; `Backspace` to correct; `Esc` to return to the menu |
| Results        | `Esc` to return to the menu                                 |

## Practice texts

Texts live in `public/texts/` as `.txt` files, and `public/texts/index.json` lists the ones shown in the menu.

To add a snippet, drop a `.txt` file into `public/texts/`, then run the formatter, which normalizes whitespace and **regenerates `index.json` automatically** from the files present:

```bash
node format-texts.mjs            # dry run — preview changes
node format-texts.mjs --write    # apply: clean the files + rebuild index.json
```

The formatter strips BOMs, normalizes line endings to LF, expands leading tabs to spaces, collapses inline tabs, removes trailing whitespace, and tidies blank-line runs — which keeps the typing engine's whitespace handling predictable.

## Project structure

```
typing-terminal/
├── index.html              # entry point, loads src/main.ts
├── format-texts.mjs        # text normalizer + index.json generator
├── src/
│   ├── main.ts             # app logic: menu, typing engine, scoring, i18n
│   └── styles.css
├── public/texts/           # practice snippets + index.json
├── src-tauri/              # Rust/Tauri backend
│   ├── src/                # lib.rs, main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
└── vite.config.ts
```

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
