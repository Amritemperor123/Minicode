import { ChatMessage, ToolDefinition } from './types';
import { LLMClient, StreamCallbacks } from './llmClient';
import { AGENT_TOOLS, executeToolCall, ToolContext } from './tools/agentTools';
import { ChildProcess } from 'child_process';

export interface AgentLoopCallbacks {
	onTextChunk: (text: string) => void;
	onStepStart: (stepNumber: number) => void;
	onToolCallStart: (toolName: string, args: Record<string, unknown>) => void;
	onToolCallResult: (toolName: string, result: string, isError?: boolean) => void;
	onAgentFinish: (summaryMessage: string) => void;
	onError: (error: Error) => void;
}

export class AgentRunner {
	private runningProcess?: ChildProcess;
	private abortController?: AbortController;

	public stop(): void {
		if (this.runningProcess) {
			try {
				this.runningProcess.kill();
			} catch {
				// ignore process kill error
			}
			this.runningProcess = undefined;
		}
		if (this.abortController) {
			this.abortController.abort();
		}
	}

	public async runAgentLoop(
		serverUrl: string,
		apiKey: string | undefined,
		modelId: string,
		userTaskPrompt: string,
		maxSteps: number,
		toolContext: ToolContext,
		callbacks: AgentLoopCallbacks,
		activeFileContext?: string
	): Promise<void> {
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		const client = new LLMClient();

		const systemPromptMessage: ChatMessage = {
			role: 'system',
			content: [
				'You are MiniCode, an autonomous AI software engineering agent inside VS Code.',
				'Your goal is to inspect, debug, edit, and fix code in the workspace on your own.',
				'You have access to tools: read_file, search, get_diagnostics, edit_file, and run_command.',
				activeFileContext ? `Active File Context:\n${activeFileContext}` : '',
				'Instructions:',
				'1. Use tools to gather information before editing or running code.',
				'2. For editing files, use edit_file with precise old_string and new_string replacements.',
				'3. Always inspect diagnostics using get_diagnostics or test outputs using run_command to verify your fixes.',
				'4. Work step-by-step. When the task is complete, provide a final response summarizing your changes and verification.'
			].filter(Boolean).join('\n\n')
		};

		const messages: ChatMessage[] = [
			systemPromptMessage,
			{ role: 'user', content: userTaskPrompt }
		];

		let currentStep = 0;

		const fullToolContext: ToolContext = {
			...toolContext,
			abortSignal: signal,
			registerRunningProcess: (proc) => {
				this.runningProcess = proc;
			},
			unregisterRunningProcess: () => {
				this.runningProcess = undefined;
			}
		};

		try {
			while (currentStep < maxSteps) {
				if (signal.aborted) {
					callbacks.onAgentFinish('Agent execution stopped by user.');
					return;
				}

				currentStep += 1;
				callbacks.onStepStart(currentStep);

				const streamCallbacks: StreamCallbacks = {
					onTextChunk: (text) => {
						callbacks.onTextChunk(text);
					}
				};

				const response = await client.streamChat(
					serverUrl,
					apiKey,
					modelId,
					messages,
					AGENT_TOOLS,
					120000,
					streamCallbacks,
					signal
				);

				if (signal.aborted) {
					callbacks.onAgentFinish('Agent execution stopped by user.');
					return;
				}

				// If no tool calls requested, agent loop finishes
				if (!response.toolCalls || response.toolCalls.length === 0) {
					callbacks.onAgentFinish('Task completed.');
					return;
				}

				// Push assistant message with tool calls to conversation history
				messages.push({
					role: 'assistant',
					content: response.content || null,
					tool_calls: response.toolCalls
				});

				// Execute tool calls sequentially
				for (const toolCall of response.toolCalls) {
					if (signal.aborted) {
						callbacks.onAgentFinish('Agent execution stopped by user.');
						return;
					}

					const toolName = toolCall.function.name;
					let parsedArgs: Record<string, unknown> = {};
					try {
						parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
					} catch {
						parsedArgs = {};
					}

					callbacks.onToolCallStart(toolName, parsedArgs);

					const toolResult = await executeToolCall(toolName, parsedArgs, fullToolContext);

					callbacks.onToolCallResult(toolName, toolResult.output, toolResult.error);

					// Push tool result to conversation history
					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						name: toolName,
						content: toolResult.output
					});
				}
			}

			callbacks.onAgentFinish(`Reached maximum step limit (${maxSteps} steps). Task stopped.`);
		} catch (error) {
			if (signal.aborted) {
				callbacks.onAgentFinish('Agent execution stopped by user.');
			} else {
				callbacks.onError(error as Error);
			}
		} finally {
			this.runningProcess = undefined;
			this.abortController = undefined;
		}
	}
}
