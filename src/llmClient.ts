import { ChatMessage, ToolDefinition, ToolCall } from './types';

export interface StreamCallbacks {
	onTextChunk: (text: string) => void;
	onToolCallStart?: (toolCall: { id: string; name: string }) => void;
}

export interface LLMResponse {
	content: string;
	toolCalls: ToolCall[];
}

export class LLMClient {
	public static buildEndpoint(serverUrl: string, path: string): string {
		const trimmed = serverUrl.replace(/\/+$/, '');
		if (trimmed.endsWith('/v1')) {
			return `${trimmed}${path}`;
		}
		return `${trimmed}/v1${path}`;
	}

	public async streamChat(
		serverUrl: string,
		apiKey: string | undefined,
		modelId: string,
		messages: ChatMessage[],
		tools: ToolDefinition[],
		timeoutMs: number,
		callbacks: StreamCallbacks,
		signal?: AbortSignal
	): Promise<LLMResponse> {
		const endpoint = LLMClient.buildEndpoint(serverUrl, '/chat/completions');

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://github.com/opencode-ai/minicode',
			'X-Title': 'MiniCode Extension'
		};
		if (apiKey) {
			headers['Authorization'] = `Bearer ${apiKey}`;
		}

		const bodyPayload: Record<string, unknown> = {
			model: modelId || 'anthropic/claude-3.5-sonnet',
			messages,
			stream: true
		};

		if (tools && tools.length > 0) {
			bodyPayload.tools = tools;
			bodyPayload.tool_choice = 'auto';
		}

		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(bodyPayload),
			signal
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`LLM request failed (${response.status}): ${errorText}`);
		}

		if (!response.body) {
			throw new Error('Response body is missing.');
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');

		let accumulatedContent = '';
		const accumulatedToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith(':')) {
						continue;
					}
					if (trimmed === 'data: [DONE]') {
						break;
					}
					if (trimmed.startsWith('data: ')) {
						const jsonStr = trimmed.slice(6);
						try {
							const parsed = JSON.parse(jsonStr);
							const delta = parsed.choices?.[0]?.delta;
							if (!delta) {
								continue;
							}

							if (typeof delta.content === 'string' && delta.content.length > 0) {
								accumulatedContent += delta.content;
								callbacks.onTextChunk(delta.content);
							}

							if (Array.isArray(delta.tool_calls)) {
								for (const tcDelta of delta.tool_calls) {
									const index = tcDelta.index ?? 0;
									let existing = accumulatedToolCalls.get(index);
									if (!existing) {
										existing = {
											id: tcDelta.id || `call_${Date.now()}_${index}`,
											name: tcDelta.function?.name || '',
											args: ''
										};
										accumulatedToolCalls.set(index, existing);
										if (callbacks.onToolCallStart) {
											callbacks.onToolCallStart({ id: existing.id, name: existing.name });
										}
									}

									if (tcDelta.function?.name && !existing.name) {
										existing.name = tcDelta.function.name;
									}
									if (tcDelta.function?.arguments) {
										existing.args += tcDelta.function.arguments;
									}
								}
							}
						} catch {
							// ignore malformed sse chunk
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		const finalToolCalls: ToolCall[] = Array.from(accumulatedToolCalls.values()).map((tc) => ({
			id: tc.id,
			type: 'function',
			function: {
				name: tc.name,
				arguments: tc.args
			}
		}));

		return {
			content: accumulatedContent,
			toolCalls: finalToolCalls
		};
	}
}
