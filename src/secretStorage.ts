import * as vscode from 'vscode';

export class SecretStorageManager {
	private static readonly API_KEY_SECRET_ID = 'minicode.apiKey';

	constructor(private readonly secrets: vscode.SecretStorage) {}

	public async getApiKey(): Promise<string | undefined> {
		return await this.secrets.get(SecretStorageManager.API_KEY_SECRET_ID);
	}

	public async setApiKey(apiKey: string): Promise<void> {
		await this.secrets.store(SecretStorageManager.API_KEY_SECRET_ID, apiKey.trim());
	}

	public async clearApiKey(): Promise<void> {
		await this.secrets.delete(SecretStorageManager.API_KEY_SECRET_ID);
	}

	public async promptSetApiKey(): Promise<boolean> {
		const currentKey = await this.getApiKey();
		const input = await vscode.window.showInputBox({
			prompt: 'Enter your LLM API Key (stored securely in VS Code SecretStorage)',
			value: currentKey ? '••••••••••••••••' : '',
			password: true,
			placeHolder: 'sk-... or OpenRouter API key'
		});

		if (input !== undefined && input !== '••••••••••••••••') {
			if (input.trim() === '') {
				await this.clearApiKey();
				void vscode.window.showInformationMessage('MiniCode API key cleared.');
			} else {
				await this.setApiKey(input.trim());
				void vscode.window.showInformationMessage('MiniCode API key saved securely in SecretStorage.');
			}
			return true;
		}
		return false;
	}
}
