import * as vscode from 'vscode';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
	role: ChatRole;
	content: string;
}

interface MinicodeSettings {
	serverUrl: string;
	chatModelId: string;
	requestTimeoutMs: number;
}

export class LocalLlmService {
	public getServerUrl(): string {
		return this.getSettings().serverUrl;
	}

	public async isEndpointReachable(): Promise<boolean> {
		try {
			const settings = this.getSettings();
			const response = await this.fetchWithTimeout(
				`${settings.serverUrl.replace(/\/$/, '')}/v1/models`,
				{ method: 'GET' },
				1500
			);
			return response.ok;
		} catch {
			return false;
		}
	}

	public async sendChat(messages: ChatMessage[]): Promise<string> {
		const settings = this.getSettings();
		const models = await this.listModels();
		const model = settings.chatModelId || models[0];
		if (!model) {
			throw new Error('No model reported by LM Studio. Check that a model is loaded and the local server is running.');
		}

		const response = await this.fetchWithTimeout(
			`${settings.serverUrl.replace(/\/$/, '')}/v1/chat/completions`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model,
					messages,
					stream: false
				})
			},
			settings.requestTimeoutMs
		);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Completion request failed (${response.status}): ${errorText}`);
		}

		const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
		const content = body.choices?.[0]?.message?.content;
		if (typeof content === 'string') {
			return content;
		}

		if (Array.isArray(content)) {
			const flattened = content
				.map((item) => (item && typeof item === 'object' && 'text' in item ? String(item.text) : ''))
				.join('');
			return flattened || '[No text response]';
		}

		return '[No text response]';
	}

	private async listModels(): Promise<string[]> {
		const settings = this.getSettings();
		const response = await this.fetchWithTimeout(
			`${settings.serverUrl.replace(/\/$/, '')}/v1/models`,
			{ method: 'GET' },
			settings.requestTimeoutMs
		);

		if (!response.ok) {
			throw new Error(`Model list request failed (${response.status}).`);
		}

		const body = (await response.json()) as { data?: Array<{ id?: string }> };
		return (body.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id));
	}

	private getSettings(): MinicodeSettings {
		const settings = vscode.workspace.getConfiguration('minicode');
		return {
			serverUrl: settings.get<string>('serverUrl', 'http://127.0.0.1:1234'),
			chatModelId: settings.get<string>('chatModelId', ''),
			requestTimeoutMs: settings.get<number>('requestTimeoutMs', 120000)
		};
	}

	private async fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(input, {
				...init,
				signal: controller.signal
			});
		} finally {
			clearTimeout(timeout);
		}
	}
}
