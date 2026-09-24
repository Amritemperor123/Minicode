import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec, ChildProcess } from 'child_process';
import { ToolDefinition, ToolResult } from '../types';
import { WorkspaceGuard } from './workspace';

export interface ToolContext {
	requestPermissionToRunCommand: (command: string) => Promise<boolean>;
	requestDiffPreviewAccept: (filePath: string, oldString: string, newString: string) => Promise<boolean>;
	abortSignal?: AbortSignal;
	registerRunningProcess?: (process: ChildProcess) => void;
	unregisterRunningProcess?: () => void;
}

export const AGENT_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read the text content of a file located within the workspace.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Relative or absolute path of the file to read.'
					}
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'search',
			description: 'Search for text or pattern across workspace files.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Text or substring to search for.'
					},
					path: {
						type: 'string',
						description: 'Optional subpath or pattern to limit search scope.'
					}
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_diagnostics',
			description: 'Get active VS Code language diagnostics (errors, warnings, lints) for a file or workspace.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Optional relative or absolute file path to filter diagnostics.'
					}
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'edit_file',
			description: 'Edit a file by replacing old_string with new_string. Prompts the user with a diff preview with Accept/Reject controls. Edits are undoable with Ctrl+Z.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Relative or absolute path of the file to edit.'
					},
					old_string: {
						type: 'string',
						description: 'Exact target string to be replaced.'
					},
					new_string: {
						type: 'string',
						description: 'Replacement content.'
					}
				},
				required: ['path', 'old_string', 'new_string']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_command',
			description: 'Run a terminal command with a 30-second timeout. Requires explicit user permission before execution.',
			parameters: {
				type: 'object',
				properties: {
					command: {
						type: 'string',
						description: 'Shell command line string to execute.'
					}
				},
				required: ['command']
			}
		}
	}
];

export async function executeToolCall(
	name: string,
	args: Record<string, unknown>,
	context: ToolContext
): Promise<ToolResult> {
	switch (name) {
		case 'read_file':
			return await executeReadFile(String(args.path ?? ''));
		case 'search':
			return await executeSearch(String(args.query ?? ''), args.path ? String(args.path) : undefined);
		case 'get_diagnostics':
			return await executeGetDiagnostics(args.path ? String(args.path) : undefined);
		case 'edit_file':
			return await executeEditFile(
				String(args.path ?? ''),
				String(args.old_string ?? ''),
				String(args.new_string ?? ''),
				context
			);
		case 'run_command':
			return await executeRunCommand(String(args.command ?? ''), context);
		default:
			return { output: `Error: Unknown tool "${name}"`, error: true };
	}
}

async function executeReadFile(filePathInput: string): Promise<ToolResult> {
	try {
		const { absolutePath, relativePath } = WorkspaceGuard.resolveAndValidatePath(filePathInput);
		const content = await fs.readFile(absolutePath, 'utf8');
		return {
			output: `File: ${relativePath}\nLines: ${content.split('\n').length}\nContent:\n\`\`\`\n${content}\n\`\`\``
		};
	} catch (error) {
		return { output: `Failed to read file: ${(error as Error).message}`, error: true };
	}
}

async function executeSearch(query: string, searchPath?: string): Promise<ToolResult> {
	try {
		if (!query) {
			return { output: 'Search query cannot be empty.', error: true };
		}
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return { output: 'No workspace folder open.', error: true };
		}

		const globPattern = searchPath ? `**/${searchPath}**` : '**/*';
		const files = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 100);

		const matches: string[] = [];
		const lowerQuery = query.toLowerCase();

		for (const fileUri of files) {
			try {
				const { relativePath } = WorkspaceGuard.resolveAndValidatePath(fileUri.fsPath);
				const content = await fs.readFile(fileUri.fsPath, 'utf8');
				const lines = content.split('\n');
				lines.forEach((line, index) => {
					if (line.toLowerCase().includes(lowerQuery)) {
						matches.push(`${relativePath}:${index + 1}: ${line.trim()}`);
					}
				});
			} catch {
				// Skip files that fail reading or fall outside workspace
			}
		}

		if (matches.length === 0) {
			return { output: `No matches found for "${query}".` };
		}

		const result = matches.slice(0, 100).join('\n');
		const countInfo = matches.length > 100 ? `\n\n(Showing first 100 of ${matches.length} matches)` : '';
		return { output: `Search results for "${query}":\n\n${result}${countInfo}` };
	} catch (error) {
		return { output: `Search failed: ${(error as Error).message}`, error: true };
	}
}

async function executeGetDiagnostics(filePathInput?: string): Promise<ToolResult> {
	try {
		let filterUri: vscode.Uri | undefined;
		if (filePathInput) {
			const { absolutePath } = WorkspaceGuard.resolveAndValidatePath(filePathInput);
			filterUri = vscode.Uri.file(absolutePath);
		}

		const allDiagnostics = vscode.languages.getDiagnostics();
		const results: string[] = [];

		for (const [uri, diagnostics] of allDiagnostics) {
			if (filterUri && uri.fsPath !== filterUri.fsPath) {
				continue;
			}
			if (diagnostics.length === 0) {
				continue;
			}

			let relPath = uri.fsPath;
			try {
				relPath = WorkspaceGuard.resolveAndValidatePath(uri.fsPath).relativePath;
			} catch {
				continue; // ignore outside workspace
			}

			for (const diag of diagnostics) {
				const severityStr =
					diag.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' :
					diag.severity === vscode.DiagnosticSeverity.Warning ? 'WARNING' : 'INFO';
				results.push(
					`[${severityStr}] ${relPath}:${diag.range.start.line + 1}:${diag.range.start.character + 1} - ${diag.message}`
				);
			}
		}

		if (results.length === 0) {
			return { output: filePathInput ? `No diagnostics reported for ${filePathInput}.` : 'No diagnostics reported in workspace.' };
		}

		return { output: `Workspace Diagnostics:\n\n${results.join('\n')}` };
	} catch (error) {
		return { output: `Failed to fetch diagnostics: ${(error as Error).message}`, error: true };
	}
}

async function executeEditFile(
	filePathInput: string,
	oldString: string,
	newString: string,
	context: ToolContext
): Promise<ToolResult> {
	try {
		const { absolutePath, relativePath } = WorkspaceGuard.resolveAndValidatePath(filePathInput);
		const fileUri = vscode.Uri.file(absolutePath);

		const document = await vscode.workspace.openTextDocument(fileUri);
		const fullText = document.getText();

		if (!fullText.includes(oldString)) {
			return {
				output: `Edit failed: old_string was not found in ${relativePath}. Make sure old_string matches the exact content in the file.`,
				error: true
			};
		}

		// Request user approval via Diff Preview
		const approved = await context.requestDiffPreviewAccept(relativePath, oldString, newString);
		if (!approved) {
			return { output: `User REJECTED the edit to ${relativePath}. File was not modified.`, error: true };
		}

		// Perform edit using WorkspaceEdit (which makes it undoable with Ctrl+Z in VS Code)
		const workspaceEdit = new vscode.WorkspaceEdit();
		const startIndex = fullText.indexOf(oldString);
		const startPos = document.positionAt(startIndex);
		const endPos = document.positionAt(startIndex + oldString.length);
		const range = new vscode.Range(startPos, endPos);

		workspaceEdit.replace(fileUri, range, newString);

		const success = await vscode.workspace.applyEdit(workspaceEdit);
		if (!success) {
			return { output: `Failed to apply workspace edit to ${relativePath}.`, error: true };
		}

		// Save document after edit
		const updatedDoc = await vscode.workspace.openTextDocument(fileUri);
		await updatedDoc.save();

		return { output: `Successfully edited ${relativePath}. Changes applied and saved (undoable with Ctrl+Z).` };
	} catch (error) {
		return { output: `Edit failed: ${(error as Error).message}`, error: true };
	}
}

async function executeRunCommand(command: string, context: ToolContext): Promise<ToolResult> {
	try {
		if (!command.trim()) {
			return { output: 'Command string cannot be empty.', error: true };
		}

		// Request permission from user
		const permitted = await context.requestPermissionToRunCommand(command);
		if (!permitted) {
			return { output: `Command execution denied by user: "${command}"`, error: true };
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

		return await new Promise<ToolResult>((resolve) => {
			let processEnded = false;

			const child: ChildProcess = exec(
				command,
				{
					cwd: workspaceFolder,
					timeout: 30000, // 30-second timeout requirement
					maxBuffer: 10 * 1024 * 1024
				},
				(error, stdout, stderr) => {
					if (processEnded) {
						return;
					}
					processEnded = true;
					if (context.unregisterRunningProcess) {
						context.unregisterRunningProcess();
					}

					const outputCombined = [
						stdout ? `stdout:\n${stdout.trim()}` : '',
						stderr ? `stderr:\n${stderr.trim()}` : ''
					].filter(Boolean).join('\n\n') || '(no output)';

					if (error) {
						if (error.killed || error.signal === 'SIGTERM') {
							resolve({ output: `Command timed out or killed after 30s limit: "${command}"\n\n${outputCombined}`, error: true });
						} else {
							resolve({ output: `Command failed with exit code ${error.code}:\n\n${outputCombined}`, error: true });
						}
					} else {
						resolve({ output: `Command executed successfully:\n\n${outputCombined}` });
					}
				}
			);

			if (context.registerRunningProcess) {
				context.registerRunningProcess(child);
			}

			// Handle cancellation via AbortSignal if provided
			if (context.abortSignal) {
				context.abortSignal.addEventListener('abort', () => {
					if (!processEnded) {
						processEnded = true;
						child.kill();
						if (context.unregisterRunningProcess) {
							context.unregisterRunningProcess();
						}
						resolve({ output: `Command terminated by user (Stop button).`, error: true });
					}
				});
			}
		});
	} catch (error) {
		return { output: `Failed to execute command: ${(error as Error).message}`, error: true };
	}
}
