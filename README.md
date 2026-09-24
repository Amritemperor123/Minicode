# MiniCode — Autonomous AI Coding Agent VS Code Extension

**MiniCode** is a VS Code extension that functions as an autonomous AI software engineering assistant. Powered by **OpenRouter** (or any OpenAI-compatible LLM endpoint), MiniCode inspects code, searches workspace files, checks language diagnostics, applies string edits with live Diff Previews, and executes terminal commands step-by-step to complete software tasks autonomously.

---

## Key Features

- **Streaming Chat Sidebar**: Real-time response streaming inside a dedicated VS Code Activity Bar webview panel.
- **Autonomous Agent Loop**: Iterative tool-calling loop (with configurable `maxAgentSteps` limit) that investigates and fixes code autonomously.
- **Dual Operation Modes**:
  - **Ask Mode**: Direct streaming conversation with active file context.
  - **Agent Mode**: Full autonomous tool-calling loop.
- **5 Core Agent Tools**:
  - `read_file`: Reads files strictly within workspace boundaries.
  - `search`: Searches text and regex patterns across workspace files.
  - `get_diagnostics`: Fetches VS Code language errors, warnings, and lints.
  - `edit_file`: String replacements with a **Diff Preview** Accept/Reject gate. Applied edits are **undoable with `Ctrl+Z`**.
  - `run_command`: Executes terminal commands with an explicit **user permission prompt** and a **30-second timeout**.
- **Instant Stop Button**: Cancels active LLM requests and immediately terminates any running terminal sub-process.
- **Secure SecretStorage**: API keys are saved securely in VS Code's encrypted `SecretStorage`—never stored in code or plain settings.

---

## Quick Setup (Using OpenRouter)

### 1. Get an OpenRouter API Key
1. Sign up or log in at [OpenRouter.ai](https://openrouter.ai/).
2. Navigate to [openrouter.ai/keys](https://openrouter.ai/keys) and generate a new API key (starts with `sk-or-v1-...`).

### 2. Store Key in MiniCode
* **Method A (Sidebar)**: Open the MiniCode sidebar panel, click **`Key`** in the header, paste your API key, and press Enter.
* **Method B (Command Palette)**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) $\rightarrow$ select **`MiniCode: Set API Key (SecretStorage)`** $\rightarrow$ paste your API key.

### 3. Configure VS Code Settings
Open VS Code Settings (`Ctrl+,` or `Cmd+,`) and search for **`minicode`**:

| Setting Name | Recommended Value | Description |
| :--- | :--- | :--- |
| `minicode.serverUrl` | `https://openrouter.ai/api/v1` | OpenRouter API base endpoint |
| `minicode.chatModelId` | `anthropic/claude-3.5-sonnet` | Selected model ID (e.g. Claude 3.5 Sonnet, DeepSeek V3/R1, GPT-4o) |
| `minicode.requestTimeoutMs` | `120000` | HTTP request timeout in milliseconds |
| `minicode.maxAgentSteps` | `25` | Maximum step limit for autonomous agent loops |

### 4. Alternative: Running Local LLMs (LM Studio, Ollama & llama.cpp)

MiniCode works seamlessly with local OpenAI-compatible API servers:

* **LM Studio**:
  1. Open LM Studio, load a model (e.g. Qwen 2.5 Coder), and click **Start Server**.
  2. Set `minicode.serverUrl` to `http://127.0.0.1:1234`.
  3. Leave `minicode.chatModelId` empty (it auto-selects the currently loaded model).

* **Ollama**:
  1. Start Ollama (`ollama serve`) and pull your model (`ollama pull qwen2.5-coder:7b`).
  2. Set `minicode.serverUrl` to `http://127.0.0.1:11434`.
  3. Set `minicode.chatModelId` to your Ollama model tag (e.g., `qwen2.5-coder:7b` or `llama3.1`).

* **llama.cpp (`llama-server`)**:
  1. Start `llama-server` with OpenAI compatibility enabled:
     ```bash
     ./llama-server -m model.gguf --port 8080 -c 8192
     ```
  2. Set `minicode.serverUrl` to `http://127.0.0.1:8080`.
  3. Set `minicode.chatModelId` to `default` (or your model name).

---

## Architecture Overview

```
src/
├── extension.ts            # Extension activation & command registration
├── secretStorage.ts        # Encrypted API key management via VS Code SecretStorage
├── types.ts                # TypeScript interfaces for tools, messages & permissions
├── llmClient.ts            # SSE streaming HTTP client with OpenRouter headers
├── agentLoop.ts            # Autonomous agent runner loop (max-steps limit & cancellation)
├── minicodeChatView.ts     # Webview view provider handling permissions & diff previews
└── tools/
    ├── workspace.ts        # WorkspaceGuard enforcing boundary security
    └── agentTools.ts       # 5 Core agent tools (read_file, search, diagnostics, edit, run_command)
media/
├── script.js               # Webview frontend script (streaming, permission cards, diff preview)
└── style.css              # Webview sidebar stylesheet
```

---

## Developer Guide

### Prerequisites
- **Node.js** (v18+ or v20+) and **npm**.
- **VS Code** (v1.105.0+).

### 1. Install Dependencies
```bash
npm install
```

### 2. Compile TypeScript
* **Single Compile**:
  ```bash
  npm run compile
  ```
* **Watch Mode** (auto-recompile on save):
  ```bash
  npm run watch
  ```

### 3. Run & Debug in VS Code
1. Open this repository folder in VS Code.
2. Press **`F5`** (or select **Run Extension** from the Debug panel).
3. A new **`[Extension Development Host]`** window will launch.
4. Click the **MiniCode** sandwich icon in the left Activity Bar to open the chat sidebar.

### 4. Linting
```bash
npm run lint
```

### 5. Package as `.vsix` Installer
To package the extension into a distributable `.vsix` installer file:
```bash
npx @vscode/vsce package --no-dependencies
```
This generates `minicode-0.0.1.vsix` in the workspace root, which can be installed in VS Code via **Extensions** $\rightarrow$ **Install from VSIX...**.
