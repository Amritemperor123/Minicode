import * as vscode from 'vscode';
import { SecretStorageManager } from './secretStorage';
import { AgentRunner } from './agentLoop';
import { LLMClient } from './llmClient';
import { ChatMessage } from './types';
import { WorkspaceGuard } from './tools/workspace';

type ChatMode = 'ask' | 'agent';

interface PendingPermissionResolver {
	id: string;
	resolve: (approved: boolean) => void;
}

export class MinicodeChatViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'minicode-chat';

	private _view?: vscode.WebviewView;
	private activeAgentRunner?: AgentRunner;
	private pendingPermissions: Map<string, (approved: boolean) => void> = new Map();
	private lastActiveEditor?: vscode.TextEditor;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly secretStorage: SecretStorageManager
	) {}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(async (data) => {
			switch (data.command) {
				case 'requestState':
					await this.refreshState();
					break;
				case 'clearConversation':
					this.stopActiveRequest();
					await this._view?.webview.postMessage({ command: 'clearMessages' });
					break;
				case 'stopRequest':
					this.stopActiveRequest();
					break;
				case 'sendMessage':
					await this.handleUserMessage(String(data.text ?? '').trim(), (data.mode as ChatMode) || 'ask');
					break;
				case 'respondCommandPermission':
					this.resolvePendingPermission(String(data.id), Boolean(data.approved));
					break;
				case 'respondDiffPreview':
					this.resolvePendingPermission(String(data.id), Boolean(data.approved));
					break;
			}
		});
	}

	public async refreshState(): Promise<void> {
		if (!this._view) {
			return;
		}

		const apiKey = await this.secretStorage.getApiKey();
		const settings = vscode.workspace.getConfiguration('minicode');
		const serverUrl = settings.get<string>('serverUrl', 'http://127.0.0.1:1234');
		const chatModelId = settings.get<string>('chatModelId', '');

		let isReachable = false;
		try {
			const modelsUrl = LLMClient.buildEndpoint(serverUrl, '/models');
			const reqHeaders: Record<string, string> = {
				'HTTP-Referer': 'https://github.com/opencode-ai/minicode'
			};
			if (apiKey) {
				reqHeaders['Authorization'] = `Bearer ${apiKey}`;
			}
			const res = await fetch(modelsUrl, { method: 'GET', headers: reqHeaders });
			isReachable = res.ok;
		} catch {
			isReachable = false;
		}

		const activeFile = this.getActiveFile();
		await this._view.webview.postMessage({
			command: 'setState',
			serverUrl,
			chatModelId,
			hasApiKey: Boolean(apiKey),
			endpointReachable: isReachable,
			activeFileName: activeFile.name,
			activeFilePath: activeFile.path
		});
	}

	private stopActiveRequest(): void {
		if (this.activeAgentRunner) {
			this.activeAgentRunner.stop();
			this.activeAgentRunner = undefined;
		}
		// Cancel all pending permissions
		for (const [id, resolve] of this.pendingPermissions.entries()) {
			resolve(false);
		}
		this.pendingPermissions.clear();
	}

	private resolvePendingPermission(id: string, approved: boolean): void {
		const resolve = this.pendingPermissions.get(id);
		if (resolve) {
			resolve(approved);
			this.pendingPermissions.delete(id);
		}
	}

	private async handleUserMessage(text: string, mode: ChatMode): Promise<void> {
		if (!text || !this._view) {
			return;
		}

		await this._view.webview.postMessage({ command: 'setPending', value: true });

		const apiKey = await this.secretStorage.getApiKey();
		const settings = vscode.workspace.getConfiguration('minicode');
		const serverUrl = settings.get<string>('serverUrl', 'http://127.0.0.1:1234');
		const chatModelId = settings.get<string>('chatModelId', '');
		const maxAgentSteps = settings.get<number>('maxAgentSteps', 25);

		if (mode === 'agent') {
			await this.runAgentMode(serverUrl, apiKey, chatModelId, text, maxAgentSteps);
		} else {
			await this.runAskMode(serverUrl, apiKey, chatModelId, text);
		}
	}

	private async runAskMode(
		serverUrl: string,
		apiKey: string | undefined,
		modelId: string,
		text: string
	): Promise<void> {
		const activeContext = this.getActiveFileContext();
		const messages: ChatMessage[] = [
			{
				role: 'system',
				content: `You are MiniCode, an AI coding assistant in VS Code.\n\n${activeContext}`
			},
			{ role: 'user', content: text }
		];

		const client = new LLMClient();
		await this._view?.webview.postMessage({ command: 'startBotStream' });

		try {
			await client.streamChat(
				serverUrl,
				apiKey,
				modelId,
				messages,
				[],
				120000,
				{
					onTextChunk: (chunk) => {
						void this._view?.webview.postMessage({ command: 'appendStreamChunk', text: chunk });
					}
				}
			);
		} catch (error) {
			void this._view?.webview.postMessage({
				command: 'appendStreamChunk',
				text: `\n\nError: ${(error as Error).message}`
			});
		} finally {
			await this._view?.webview.postMessage({ command: 'setPending', value: false });
			await this.refreshState();
		}
	}

	private async runAgentMode(
		serverUrl: string,
		apiKey: string | undefined,
		modelId: string,
		text: string,
		maxSteps: number
	): Promise<void> {
		this.activeAgentRunner = new AgentRunner();

		const toolContext = {
			requestPermissionToRunCommand: (command: string) => {
				return new Promise<boolean>((resolve) => {
					const permId = `perm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
					this.pendingPermissions.set(permId, resolve);
					void this._view?.webview.postMessage({
						command: 'requestCommandPermission',
						id: permId,
						commandText: command
					});
				});
			},
			requestDiffPreviewAccept: (filePath: string, oldString: string, newString: string) => {
				return new Promise<boolean>((resolve) => {
					const permId = `diff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
					this.pendingPermissions.set(permId, resolve);
					void this._view?.webview.postMessage({
						command: 'requestDiffPreview',
						id: permId,
						filePath,
						oldString,
						newString
					});
				});
			}
		};

		const activeContext = this.getActiveFileContext();

		try {
			await this.activeAgentRunner.runAgentLoop(
				serverUrl,
				apiKey,
				modelId,
				text,
				maxSteps,
				toolContext,
				{
					onStepStart: (stepNum) => {
						void this._view?.webview.postMessage({ command: 'agentStepStart', step: stepNum });
					},
					onTextChunk: (chunk) => {
						void this._view?.webview.postMessage({ command: 'appendStreamChunk', text: chunk });
					},
					onToolCallStart: (toolName, args) => {
						void this._view?.webview.postMessage({
							command: 'agentToolCallStart',
							toolName,
							args
						});
					},
					onToolCallResult: (toolName, result, isError) => {
						void this._view?.webview.postMessage({
							command: 'agentToolCallResult',
							toolName,
							result,
							isError
						});
					},
					onAgentFinish: (summary) => {
						void this._view?.webview.postMessage({ command: 'agentFinish', summary });
					},
					onError: (err) => {
						void this._view?.webview.postMessage({ command: 'agentError', error: err.message });
					}
				},
				activeContext
			);
		} finally {
			this.activeAgentRunner = undefined;
			await this._view?.webview.postMessage({ command: 'setPending', value: false });
			await this.refreshState();
		}
	}

	private getActiveEditor(): vscode.TextEditor | undefined {
		const active = vscode.window.activeTextEditor;
		if (active) {
			this.lastActiveEditor = active;
			return active;
		}
		if (this.lastActiveEditor && !this.lastActiveEditor.document.isClosed) {
			return this.lastActiveEditor;
		}
		const visible = vscode.window.visibleTextEditors;
		if (visible.length > 0) {
			this.lastActiveEditor = visible[0];
			return visible[0];
		}
		return undefined;
	}

	private getActiveFile(): { name: string; path: string } {
		const editor = this.getActiveEditor();
		if (!editor) {
			return { name: 'No file', path: 'No active file' };
		}
		const document = editor.document;
		if (document.uri.scheme === 'untitled') {
			return { name: document.fileName || 'Untitled', path: 'Untitled file' };
		}
		const segments = document.fileName.split(/[\\/]/);
		return {
			name: segments[segments.length - 1] || document.fileName,
			path: vscode.workspace.asRelativePath(document.uri, false)
		};
	}

	private getActiveFileContext(): string {
		const editor = this.getActiveEditor();
		if (!editor) {
			return '<active_file>No active editor file is open.</active_file>';
		}
		const document = editor.document;
		const activeFile = this.getActiveFile();
		const maxChars = vscode.workspace.getConfiguration('minicode').get<number>('activeFileContextMaxChars', 30000);
		const fullText = document.getText();
		const text = fullText.length <= maxChars ? fullText : fullText.slice(0, maxChars) + '\n\n[Truncated]';

		return [
			'<active_file>',
			`Path: ${activeFile.path}`,
			`Language: ${document.languageId}`,
			`Lines: ${document.lineCount}`,
			'Content:',
			'```',
			text,
			'```',
			'</active_file>'
		].join('\n');
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'script.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));
		const nonce = this.getNonce();

		return `<!DOCTYPE html>
				<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
					<link rel="stylesheet" href="${styleUri}">
					<title>MiniCode Chat</title>
				</head>
				<body>
					<div class="chat-container">
						<header class="top-bar">
							<div class="title-group">
								<div class="title">MiniCode</div>
								<div class="status-line">
									<span id="connection-dot" class="connection-dot" aria-hidden="true"></span>
									<span id="server-status">LM Studio</span>
								</div>
							</div>
							<div class="header-actions">
								<button id="stop-button" class="icon-button danger hidden" title="Stop request" type="button">🛑 Stop</button>
								<button id="clear-chat-button" class="icon-button secondary" title="Clear chat" type="button">Clear</button>
							</div>
						</header>

						<div class="message-area" id="message-area" role="log" aria-live="polite"></div>

						<form class="input-area" id="input-area" onsubmit="return false;">
							<div class="composer">
								<div class="mode-row">
									<label class="mode-picker" for="mode-select">
										<span class="mode-label">Mode</span>
										<select id="mode-select" class="mode-select">
											<option value="ask">Ask</option>
											<option value="agent" selected>Agent</option>
										</select>
									</label>
									<span id="active-file" class="file-bubble" title="No active file">No file</span>
								</div>
								<div class="input-wrapper">
									<textarea id="message-input" placeholder="Ask MiniCode to fix code..." rows="1"></textarea>
								</div>
							</div>
							<button id="send-button" class="icon-button" type="button" aria-label="Send">
								🚀
							</button>
						</form>
					</div>
					<script nonce="${nonce}" src="${scriptUri}"></script>
				</body>
				</html>`;
	}

	private getNonce(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let nonce = '';
		for (let i = 0; i < 32; i += 1) {
			nonce += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return nonce;
	}
}
