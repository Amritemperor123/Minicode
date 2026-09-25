const vscode = acquireVsCodeApi();

const messageArea = document.getElementById('message-area');
const messageInput = document.getElementById('message-input');
const modeSelect = document.getElementById('mode-select');
const sendButton = document.getElementById('send-button');
const stopButton = document.getElementById('stop-button');
const inputForm = document.getElementById('input-area');
const clearChatButton = document.getElementById('clear-chat-button');
const serverStatus = document.getElementById('server-status');
const connectionDot = document.getElementById('connection-dot');
const activeFile = document.getElementById('active-file');

let pending = false;
let currentBotBubble = null;
let currentBotText = '';
let loadingIndicator = null;

function formatTime(date = new Date()) {
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function createCopilotLoadingElement(text = 'Generating response', isInline = false) {
	const container = document.createElement('div');
	container.className = `copilot-loading-indicator${isInline ? ' inline-loading' : ''}`;

	const sparkle = document.createElement('span');
	sparkle.className = 'copilot-sparkle';
	sparkle.innerHTML = `<svg class="copilot-sparkle-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
		<path d="M7.5 0L9.3 5.7L15 7.5L9.3 9.3L7.5 15L5.7 9.3L0 7.5L5.7 5.7L7.5 0Z"/>
	</svg>`;

	const label = document.createElement('span');
	label.className = 'copilot-loading-text';
	label.textContent = text;

	const dots = document.createElement('div');
	dots.className = 'copilot-loading-dots';
	dots.innerHTML = '<span></span><span></span><span></span>';

	container.appendChild(sparkle);
	container.appendChild(label);
	container.appendChild(dots);
	return container;
}

function showLoadingIndicator(text = 'Generating response') {
	if (loadingIndicator) {
		const textEl = loadingIndicator.querySelector('.copilot-loading-text');
		if (textEl) {
			textEl.textContent = text;
		}
		return;
	}
	const wrap = document.createElement('div');
	wrap.className = 'message bot loading-message';

	const container = createCopilotLoadingElement(text, false);
	wrap.appendChild(container);

	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;
	loadingIndicator = wrap;
}

function hideLoadingIndicator() {
	if (loadingIndicator) {
		loadingIndicator.remove();
		loadingIndicator = null;
	}
}

function addMessage(text, sender = 'bot') {
	const wrap = document.createElement('div');
	wrap.className = `message ${sender}`;

	const bubble = document.createElement('div');
	bubble.className = 'bubble';
	bubble.textContent = text;

	const meta = document.createElement('div');
	meta.className = 'meta';
	meta.textContent = formatTime();

	wrap.appendChild(bubble);
	wrap.appendChild(meta);
	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;
	return bubble;
}

function startBotStream() {
	hideLoadingIndicator();
	currentBotText = '';
	const wrap = document.createElement('div');
	wrap.className = 'message bot';

	const bubble = document.createElement('div');
	bubble.className = 'bubble streaming-bubble is-streaming';

	const inlineLoading = createCopilotLoadingElement('Generating response', true);
	bubble.appendChild(inlineLoading);

	const meta = document.createElement('div');
	meta.className = 'meta';
	meta.textContent = formatTime();

	wrap.appendChild(bubble);
	wrap.appendChild(meta);
	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;

	currentBotBubble = bubble;
}

function appendStreamChunk(chunk) {
	hideLoadingIndicator();
	if (!currentBotBubble) {
		startBotStream();
	}
	if (currentBotText === '') {
		currentBotBubble.innerHTML = '';
	}
	currentBotText += chunk;
	currentBotBubble.textContent = currentBotText;
	messageArea.scrollTop = messageArea.scrollHeight;
}

function addToolBadge(toolName, args) {
	const wrap = document.createElement('div');
	wrap.className = 'tool-card';

	const title = document.createElement('div');
	title.className = 'tool-title';
	title.textContent = `🛠️ Tool: ${toolName}`;

	const details = document.createElement('pre');
	details.className = 'tool-args';
	details.textContent = JSON.stringify(args, null, 2);

	wrap.appendChild(title);
	wrap.appendChild(details);
	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;
}

function addToolResult(toolName, result, isError) {
	const wrap = document.createElement('div');
	wrap.className = `tool-result ${isError ? 'error' : 'success'}`;

	const header = document.createElement('div');
	header.className = 'result-header';
	header.textContent = isError ? `❌ Tool Failed (${toolName})` : `✅ Tool Completed (${toolName})`;

	const body = document.createElement('pre');
	body.className = 'result-body';
	body.textContent = result;

	wrap.appendChild(header);
	wrap.appendChild(body);
	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;
}

function addCommandPermissionCard(id, commandText) {
	const wrap = document.createElement('div');
	wrap.className = 'permission-card';

	const title = document.createElement('div');
	title.className = 'card-title';
	title.textContent = '⚠️ Command Execution Permission Requested';

	const desc = document.createElement('div');
	desc.className = 'card-desc';
	desc.textContent = 'MiniCode agent wants to run the following terminal command:';

	const cmd = document.createElement('pre');
	cmd.className = 'code-block';
	cmd.textContent = commandText;

	const btnRow = document.createElement('div');
	btnRow.className = 'btn-row';

	const allowBtn = document.createElement('button');
	allowBtn.className = 'action-btn allow';
	allowBtn.textContent = 'Allow Command';
	allowBtn.onclick = () => {
		wrap.innerHTML = `<div class="status-approved">✅ Allowed: <code>${commandText}</code></div>`;
		vscode.postMessage({ command: 'respondCommandPermission', id, approved: true });
	};

	const denyBtn = document.createElement('button');
	denyBtn.className = 'action-btn deny';
	denyBtn.textContent = 'Deny';
	denyBtn.onclick = () => {
		wrap.innerHTML = `<div class="status-denied">❌ Denied: <code>${commandText}</code></div>`;
		vscode.postMessage({ command: 'respondCommandPermission', id, approved: false });
	};

	btnRow.appendChild(allowBtn);
	btnRow.appendChild(denyBtn);

	wrap.appendChild(title);
	wrap.appendChild(desc);
	wrap.appendChild(cmd);
	wrap.appendChild(btnRow);

	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;
}

function addDiffPreviewCard(id, filePath, oldString, newString) {
	const wrap = document.createElement('div');
	wrap.className = 'diff-card';

	const title = document.createElement('div');
	title.className = 'card-title';
	title.textContent = `📝 File Edit Diff Preview: ${filePath}`;

	const diffContainer = document.createElement('div');
	diffContainer.className = 'diff-container';

	const oldBlock = document.createElement('pre');
	oldBlock.className = 'diff-removed';
	oldBlock.textContent = `- ${oldString}`;

	const newBlock = document.createElement('pre');
	newBlock.className = 'diff-added';
	newBlock.textContent = `+ ${newString}`;

	diffContainer.appendChild(oldBlock);
	diffContainer.appendChild(newBlock);

	const btnRow = document.createElement('div');
	btnRow.className = 'btn-row';

	const acceptBtn = document.createElement('button');
	acceptBtn.className = 'action-btn allow';
	acceptBtn.textContent = 'Accept Edit (Ctrl+Z to Undo)';
	acceptBtn.onclick = () => {
		wrap.innerHTML = `<div class="status-approved">✅ Edit Accepted: ${filePath}</div>`;
		vscode.postMessage({ command: 'respondDiffPreview', id, approved: true });
	};

	const rejectBtn = document.createElement('button');
	rejectBtn.className = 'action-btn deny';
	rejectBtn.textContent = 'Reject Edit';
	rejectBtn.onclick = () => {
		wrap.innerHTML = `<div class="status-denied">❌ Edit Rejected: ${filePath}</div>`;
		vscode.postMessage({ command: 'respondDiffPreview', id, approved: false });
	};

	btnRow.appendChild(acceptBtn);
	btnRow.appendChild(rejectBtn);

	wrap.appendChild(title);
	wrap.appendChild(diffContainer);
	wrap.appendChild(btnRow);

	messageArea.appendChild(wrap);
	messageArea.scrollTop = messageArea.scrollHeight;
}

function setPending(isPending) {
	pending = isPending;
	messageInput.disabled = pending;
	sendButton.disabled = pending;
	stopButton.classList.toggle('hidden', !pending);
	if (pending) {
		if (!currentBotBubble) {
			showLoadingIndicator('Generating response');
		}
	} else {
		hideLoadingIndicator();
		if (currentBotBubble) {
			currentBotBubble.classList.remove('is-streaming');
		}
		currentBotBubble = null;
		currentBotText = '';
	}
}

function setState(state) {
	const isConnected = Boolean(state.endpointReachable);
	serverStatus.textContent = 'LM Studio';
	connectionDot.classList.toggle('connected', isConnected);
	connectionDot.classList.toggle('offline', !isConnected);
	activeFile.textContent = state.activeFileName ?? 'No file';
	activeFile.title = state.activeFilePath ?? 'No active file';
}

function sendMessage() {
	const message = messageInput.value.trim();
	if (!message || pending) {
		return;
	}

	addMessage(message, 'user');
	vscode.postMessage({ command: 'sendMessage', text: message, mode: modeSelect.value });
	messageInput.value = '';
	resizeInput();
}

sendButton.addEventListener('click', sendMessage);
stopButton.addEventListener('click', () => {
	vscode.postMessage({ command: 'stopRequest' });
});

messageInput.addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		sendMessage();
	}
});

if (inputForm) {
	inputForm.addEventListener('submit', (event) => {
		event.preventDefault();
		sendMessage();
	});
}

clearChatButton.addEventListener('click', () => {
	vscode.postMessage({ command: 'clearConversation' });
});

function resizeInput() {
	messageInput.style.height = 'auto';
	messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
}
messageInput.addEventListener('input', resizeInput);

window.addEventListener('message', (event) => {
	const message = event.data;
	switch (message.command) {
		case 'startBotStream':
			startBotStream();
			break;
		case 'appendStreamChunk':
			appendStreamChunk(message.text);
			break;
		case 'setPending':
			setPending(Boolean(message.value));
			break;
		case 'setState':
			setState(message);
			break;
		case 'agentStepStart':
			hideLoadingIndicator();
			addMessage(`--- Step ${message.step} ---`, 'bot');
			if (pending) {
				showLoadingIndicator('Generating response');
			}
			break;
		case 'agentToolCallStart':
			hideLoadingIndicator();
			if (currentBotBubble) {
				currentBotBubble.classList.remove('is-streaming');
				currentBotBubble = null;
			}
			addToolBadge(message.toolName, message.args);
			if (pending) {
				showLoadingIndicator('Running tool...');
			}
			break;
		case 'agentToolCallResult':
			hideLoadingIndicator();
			addToolResult(message.toolName, message.result, message.isError);
			if (pending) {
				showLoadingIndicator('Generating response');
			}
			break;
		case 'agentFinish':
			hideLoadingIndicator();
			if (message.summary && message.summary !== 'Task completed.') {
				addMessage(`🏁 Agent Finished: ${message.summary}`, 'bot');
			}
			setPending(false);
			break;
		case 'agentError':
			hideLoadingIndicator();
			addMessage(`❌ Agent Error: ${message.error}`, 'bot');
			setPending(false);
			break;
		case 'requestCommandPermission':
			hideLoadingIndicator();
			addCommandPermissionCard(message.id, message.commandText);
			break;
		case 'requestDiffPreview':
			hideLoadingIndicator();
			addDiffPreviewCard(message.id, message.filePath, message.oldString, message.newString);
			break;
		case 'clearMessages':
			hideLoadingIndicator();
			messageArea.innerHTML = '';
			currentBotBubble = null;
			currentBotText = '';
			break;
		default:
			break;
	}
});

vscode.postMessage({ command: 'requestState' });
setInterval(() => {
	vscode.postMessage({ command: 'requestState' });
}, 5000);
