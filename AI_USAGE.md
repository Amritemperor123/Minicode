# AI Usage Disclosure (AI_USAGE.md)

This document details the AI models, tools, and assistance used during the development of the **MiniCode** VS Code Extension and related analysis.

---

## Summary of AI Tools Used

| Tool / Assistant | Usage Area | Description & Details |
| :--- | :--- | :--- |
| **Antigravity AI (Gemini 3.6 Flash)** | Extension Refactoring | Used for analyzing repository structure, modularizing TypeScript code, generating VS Code extension components, tool definitions, and webview HTML/CSS/JS interface. |
| **Antigravity Code Search & File Inspection** | Codebase Analysis | Utilized for deep file inspection and reverse-engineering the archived Opencode Go repository (`github.com/opencode-ai/opencode`) to locate and document the `auto compact` feature implementation. |
| **TypeScript / VS Code API Pair Programming** | Implementation & Security Verification | Assisted in structuring `WorkspaceGuard` security bounds, `SecretStorageManager` API key handling, `AgentRunner` loop, and `Diff Preview` / `Command Permission` webview UI cards. |

---

## Detailed Locations of AI Assistance in Codebase

1. **MiniCode Core Extension (`src/`)**:
   - [`src/secretStorage.ts`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/src/secretStorage.ts): Built secure API key manager using VS Code `SecretStorage` API (`context.secrets`).
   - [`src/tools/workspace.ts`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/src/tools/workspace.ts): Designed path boundary guard preventing file access outside workspace roots.
   - [`src/tools/agentTools.ts`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/src/tools/agentTools.ts): Implemented the 5 agent tools (`read_file`, `search`, `get_diagnostics`, `edit_file` with undoable `vscode.workspace.applyEdit`, and `run_command` with 30s timeout).
   - [`src/llmClient.ts`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/src/llmClient.ts): Implemented SSE response stream parser and OpenAI/LM Studio tool call aggregator.
   - [`src/agentLoop.ts`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/src/agentLoop.ts): Built autonomous agent runner loop with max-steps limit, step callbacks, and instant stop support.
   - [`src/minicodeChatView.ts`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/src/minicodeChatView.ts): Built webview view provider handling permissions, diff previews, state synchronization, and streaming messaging.

2. **Webview UI (`media/`)**:
   - [`media/script.js`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/media/script.js) & [`media/style.css`](file:///C:/Users/amrit/Desktop/Work/Projects/Minicode/media/style.css): Styled chat interface, tool execution cards, command permission cards, and diff preview cards with Accept/Reject controls.
