import * as vscode from 'vscode';
import * as path from 'path';

export class WorkspaceGuard {
	/**
	 * Validates that a path is strictly inside one of the current workspace folders.
	 * Returns absolute path if valid, or throws an error if outside workspace.
	 */
	public static resolveAndValidatePath(relativePathOrAbsolute: string): { absolutePath: string; relativePath: string } {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error('No workspace folder is open in VS Code.');
		}

		let targetPath: string;
		if (path.isAbsolute(relativePathOrAbsolute)) {
			targetPath = path.normalize(relativePathOrAbsolute);
		} else {
			const root = workspaceFolders[0].uri.fsPath;
			targetPath = path.normalize(path.join(root, relativePathOrAbsolute));
		}

		// Check if targetPath is inside any workspace folder
		const isInside = workspaceFolders.some((folder) => {
			const folderPath = path.normalize(folder.uri.fsPath);
			const relative = path.relative(folderPath, targetPath);
			return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
		});

		if (!isInside) {
			throw new Error(`Permission Denied: File path "${relativePathOrAbsolute}" is outside the workspace root.`);
		}

		const primaryRoot = workspaceFolders[0].uri.fsPath;
		const rel = path.relative(primaryRoot, targetPath).replace(/\\/g, '/');

		return {
			absolutePath: targetPath,
			relativePath: rel || path.basename(targetPath)
		};
	}
}
