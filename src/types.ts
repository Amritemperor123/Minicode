import * as vscode from 'vscode';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface FunctionCall {
	name: string;
	arguments: string; // JSON string
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: FunctionCall;
}

export interface ChatMessage {
	role: ChatRole;
	content: string | null;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
	name?: string;
}

export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: string;
			properties: Record<string, unknown>;
			required?: string[];
		};
	};
}

export interface MinicodeSettings {
	serverUrl: string;
	chatModelId: string;
	requestTimeoutMs: number;
	activeFileContextMaxChars: number;
	maxAgentSteps: number;
}

export interface ToolResult {
	output: string;
	error?: boolean;
}

export type PermissionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PendingCommandPermission {
	id: string;
	command: string;
	resolve: (approved: boolean) => void;
}

export interface PendingEditPreview {
	id: string;
	filePath: string;
	oldString: string;
	newString: string;
	resolve: (approved: boolean) => void;
}
