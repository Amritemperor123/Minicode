import * as vscode from 'vscode';
import { MinicodeChatViewProvider } from './minicodeChatView';
import { SecretStorageManager } from './secretStorage';

export function activate(context: vscode.ExtensionContext) {
	const secretStorage = new SecretStorageManager(context.secrets);
	const provider = new MinicodeChatViewProvider(context.extensionUri, secretStorage);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(MinicodeChatViewProvider.viewType, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('minicode.setApiKey', async () => {
			await secretStorage.promptSetApiKey();
			await provider.refreshState();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('minicode.clearApiKey', async () => {
			await secretStorage.clearApiKey();
			void vscode.window.showInformationMessage('MiniCode API key cleared.');
			await provider.refreshState();
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			void provider.refreshState();
		})
	);
}

export function deactivate() {}
