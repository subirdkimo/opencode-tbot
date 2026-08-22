import { a as mergePluginConfigSources, d as loadAppConfig, f as calculateDisplayedTokenTotal, i as loadPluginConfigFile, l as OPENCODE_TBOT_VERSION, m as getGlobalPluginConfigFilePath, o as preparePluginConfiguration, r as validateTelegramBotAccessWithBot, s as writePluginConfigFile, t as TelegramStartupError } from "./assets/telegram-bot-access-DKhF1Ko4.js";
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Bot, GrammyError, HttpError, InlineKeyboard, InputFile } from "grammy";
import { randomUUID } from "node:crypto";
import { createOpencodeClient } from "@opencode-ai/sdk";
import { run } from "@grammyjs/runner";
//#region src/infra/utils/redact.ts
var REDACTED$1 = "[REDACTED]";
var TELEGRAM_TOKEN_PATTERN = /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g;
var BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi;
var NAMED_SECRET_PATTERN = /\b(api[_\s-]?key|token|secret|password)\b(\s*[:=]\s*)([^\s,;]+)/gi;
var API_KEY_LIKE_PATTERN = /\b(?:sk|pk)_[A-Za-z0-9_-]{10,}\b/g;
function redactSensitiveText(input) {
	return input.replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED$1}`).replace(TELEGRAM_TOKEN_PATTERN, REDACTED$1).replace(NAMED_SECRET_PATTERN, (_, name, separator) => `${name}${separator}${REDACTED$1}`).replace(API_KEY_LIKE_PATTERN, REDACTED$1);
}
//#endregion
//#region src/infra/logger/index.ts
var DEFAULT_COMPONENT = "app";
var DEFAULT_EVENT = "log";
var DEFAULT_SERVICE_NAME = "opencode-tbot";
var DEFAULT_MAX_LOG_FILES = 30;
var DEFAULT_MAX_TOTAL_LOG_BYTES = 314572800;
var CONTENT_OMITTED = "[OMITTED]";
var REDACTED = "[REDACTED]";
var LEVEL_PRIORITY = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40
};
var RESERVED_EVENT_FIELDS = new Set([
	"attempt",
	"callbackData",
	"chatId",
	"command",
	"component",
	"correlationId",
	"durationMs",
	"error",
	"event",
	"operationId",
	"projectId",
	"requestId",
	"runtimeId",
	"sessionId",
	"sizeBytes",
	"status",
	"updateId",
	"worktree"
]);
function createOpenCodeAppLogger(client, options = {}) {
	const service = normalizeServiceName(options.service);
	const minimumLevel = normalizeLogLevel(options.level);
	const runtimeId = normalizeString(options.runtimeId) ?? randomUUID();
	const boundRootContext = {
		component: DEFAULT_COMPONENT,
		runtimeId,
		...options.worktree ? { worktree: options.worktree } : {}
	};
	const sinks = createSinks(client, {
		file: {
			dir: options.file?.dir,
			maxFiles: options.file?.retention?.maxFiles,
			maxTotalBytes: options.file?.retention?.maxTotalBytes
		},
		runtimeId,
		service,
		sinks: options.sinks
	});
	let queue = Promise.resolve();
	const enqueue = (event) => {
		if (LEVEL_PRIORITY[event.level] < LEVEL_PRIORITY[minimumLevel]) return;
		const structuredEvent = buildStructuredLogEvent(event.level, event.input, event.message, service, event.context);
		queue = queue.catch(() => void 0).then(async () => {
			await Promise.allSettled(sinks.map((sink) => sink.write(structuredEvent)));
		});
	};
	const createLogger = (context) => ({
		debug(input, message) {
			enqueue({
				context,
				input,
				level: "debug",
				message
			});
		},
		info(input, message) {
			enqueue({
				context,
				input,
				level: "info",
				message
			});
		},
		warn(input, message) {
			enqueue({
				context,
				input,
				level: "warn",
				message
			});
		},
		error(input, message) {
			enqueue({
				context,
				input,
				level: "error",
				message
			});
		},
		child(childContext) {
			return createLogger({
				...context,
				...removeUndefinedFields(childContext)
			});
		},
		async flush() {
			await queue.catch(() => void 0);
			await Promise.allSettled(sinks.map(async (sink) => {
				await sink.flush?.();
			}));
		}
	});
	return createLogger(boundRootContext);
}
function logTelegramUpdate(logger, input, message) {
	logger.info({
		component: "telegram",
		...input
	}, message);
}
function logPromptLifecycle(logger, input, message) {
	logger.info({
		component: "prompt",
		...input
	}, message);
}
function logOpenCodeRequest(logger, input, message) {
	logger.info({
		component: "opencode",
		...input
	}, message);
}
function logPluginEvent(logger, input, message) {
	logger.info({
		component: "plugin-event",
		...input
	}, message);
}
function createSinks(client, options) {
	const sinkOptions = options.sinks ?? {};
	const sinks = [];
	if (sinkOptions.host !== false) sinks.push(createHostSink(client, options.service));
	if (sinkOptions.file !== false && options.file?.dir) sinks.push(createJsonlFileSink({
		dir: options.file.dir,
		maxFiles: options.file.maxFiles,
		maxTotalBytes: options.file.maxTotalBytes,
		runtimeId: options.runtimeId
	}));
	return sinks;
}
function createHostSink(client, service) {
	return { async write(event) {
		await client.app.log({
			body: {
				service,
				level: event.level,
				message: event.message,
				extra: buildHostLogExtra(event)
			},
			throwOnError: true,
			responseStyle: "data"
		});
	} };
}
function createJsonlFileSink(options) {
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_LOG_FILES;
	const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_LOG_BYTES;
	const runtimeSegment = sanitizeFileSegment(options.runtimeId);
	const timestampSegment = (/* @__PURE__ */ new Date()).toISOString().replace(/:/gu, "-");
	const filePath = join(options.dir, `${timestampSegment}.${process.pid}.${runtimeSegment}.jsonl`);
	let initialized = false;
	let writeCount = 0;
	const initialize = async () => {
		if (initialized) return;
		await mkdir(options.dir, { recursive: true });
		await cleanupLogDirectory(options.dir, maxFiles, maxTotalBytes);
		initialized = true;
	};
	return { async write(event) {
		await initialize();
		await appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
		writeCount += 1;
		if (writeCount === 1 || writeCount % 100 === 0) await cleanupLogDirectory(options.dir, maxFiles, maxTotalBytes);
	} };
}
async function cleanupLogDirectory(directory, maxFiles, maxTotalBytes) {
	let entries = [];
	try {
		const names = await readdir(directory);
		entries = await Promise.all(names.filter((name) => name.endsWith(".jsonl")).map(async (name) => {
			const entryPath = join(directory, name);
			const entryStat = await stat(entryPath);
			return {
				path: entryPath,
				size: entryStat.size,
				time: entryStat.mtimeMs
			};
		}));
	} catch {
		return;
	}
	entries.sort((left, right) => right.time - left.time);
	let totalBytes = 0;
	const retained = [];
	const deleted = [];
	for (const entry of entries) {
		const canKeepByCount = retained.length < maxFiles;
		const canKeepBySize = retained.length === 0 || totalBytes + entry.size <= maxTotalBytes;
		if (canKeepByCount && canKeepBySize) {
			retained.push(entry);
			totalBytes += entry.size;
			continue;
		}
		deleted.push(entry);
	}
	await Promise.allSettled(deleted.map(async (entry) => {
		await unlink(entry.path);
	}));
}
function buildStructuredLogEvent(level, input, message, service, boundContext) {
	const extracted = extractContextAndExtra(input);
	const context = {
		...removeUndefinedFields(boundContext),
		...removeUndefinedFields(extracted.context)
	};
	const resolvedMessage = normalizeLogMessage(input, message);
	return {
		ts: (/* @__PURE__ */ new Date()).toISOString(),
		level,
		service,
		component: normalizeComponent(context.component),
		event: normalizeEventName(context.event),
		message: redactSensitiveText(resolvedMessage),
		runtimeId: context.runtimeId ?? null,
		operationId: context.operationId ?? null,
		correlationId: resolveCorrelationId(context),
		...context.worktree ? { worktree: redactSensitiveText(context.worktree) } : {},
		...typeof context.chatId === "number" ? { chatId: context.chatId } : {},
		...context.sessionId ? { sessionId: context.sessionId } : {},
		...context.projectId ? { projectId: context.projectId } : {},
		...context.requestId ? { requestId: context.requestId } : {},
		...typeof context.updateId === "number" ? { updateId: context.updateId } : {},
		...context.command ? { command: context.command } : {},
		...context.callbackData ? { callbackData: context.callbackData } : {},
		...typeof context.durationMs === "number" ? { durationMs: context.durationMs } : {},
		...typeof context.attempt === "number" ? { attempt: context.attempt } : {},
		...context.status ? { status: context.status } : {},
		...typeof context.sizeBytes === "number" ? { sizeBytes: context.sizeBytes } : {},
		...context.error ? { error: context.error } : {},
		...removeUndefinedFields(extracted.extra)
	};
}
function buildHostLogExtra(event) {
	const { service: _service, level: _level, message: _message, ...rest } = event;
	return rest;
}
function extractContextAndExtra(input) {
	if (input instanceof Error) return {
		context: { error: serializeError(input) },
		extra: {}
	};
	if (Array.isArray(input)) return {
		context: {},
		extra: { items: input.map((item) => sanitizeValue(item)) }
	};
	if (input === null || input === void 0) return {
		context: {},
		extra: {}
	};
	if (typeof input === "string") return {
		context: {},
		extra: {}
	};
	if (typeof input !== "object") return {
		context: {},
		extra: { value: sanitizeValue(input) }
	};
	const record = input;
	const context = {};
	const extra = {};
	for (const [key, value] of Object.entries(record)) {
		if (RESERVED_EVENT_FIELDS.has(key)) {
			assignReservedField(context, key, value);
			continue;
		}
		extra[key] = sanitizeFieldValue(key, value);
	}
	return {
		context,
		extra
	};
}
function assignReservedField(context, key, value) {
	switch (key) {
		case "attempt":
		case "durationMs":
		case "sizeBytes":
			if (typeof value === "number") context[key] = value;
			return;
		case "chatId":
		case "updateId":
			if (typeof value === "number") context[key] = value;
			return;
		case "callbackData":
		case "command":
		case "component":
		case "event":
		case "projectId":
		case "requestId":
		case "sessionId":
		case "status":
		case "worktree":
			if (typeof value === "string" && value.trim().length > 0) context[key] = redactSensitiveText(value.trim());
			return;
		case "correlationId":
		case "operationId":
		case "runtimeId":
			if (typeof value === "string" && value.trim().length > 0) context[key] = value.trim();
			else if (value === null) context[key] = null;
			return;
		case "error":
			if (value instanceof Error) context.error = serializeError(value);
			else if (isPlainObject(value)) context.error = normalizeStructuredLogErrorRecord(value);
			return;
		default: return;
	}
}
function normalizeLogMessage(input, message) {
	if (typeof input === "string") {
		const normalizedInput = input.trim();
		return normalizedInput.length > 0 ? normalizedInput : "log";
	}
	if (message && message.trim().length > 0) return message.trim();
	if (input instanceof Error) return input.message.trim() || input.name;
	return "log";
}
function normalizeServiceName(value) {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : DEFAULT_SERVICE_NAME;
}
function normalizeLogLevel(value) {
	switch (value?.trim().toLowerCase()) {
		case "debug": return "debug";
		case "warn": return "warn";
		case "error": return "error";
		default: return "info";
	}
}
function normalizeComponent(value) {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : DEFAULT_COMPONENT;
}
function normalizeEventName(value) {
	const normalized = value?.trim();
	return normalized && normalized.length > 0 ? normalized : DEFAULT_EVENT;
}
function resolveCorrelationId(context) {
	if (context.correlationId) return context.correlationId;
	if (typeof context.updateId === "number") return String(context.updateId);
	return context.operationId ?? null;
}
function serializeError(error) {
	return {
		name: error.name,
		message: redactSensitiveText(error.message),
		...error.stack ? { stack: redactSensitiveText(error.stack) } : {},
		..."data" in error && error.data && typeof error.data === "object" ? { data: sanitizeValue(error.data) } : {}
	};
}
function sanitizePlainObject(value) {
	return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, sanitizeFieldValue(key, entryValue)]));
}
function sanitizeFieldValue(key, value) {
	if (isSensitiveKey(key)) return redactSensitiveFieldValue(value);
	if (isUrlLikeKey(key)) return summarizeUrlValue(value);
	if (isTextContentKey(key)) return summarizeTextValue(value);
	if (isAttachmentCollectionKey(key)) return summarizeAttachmentCollection(value);
	return sanitizeValue(value);
}
function sanitizeValue(value) {
	if (value instanceof Error) return serializeError(value);
	if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
	if (typeof value === "string") return redactSensitiveText(value);
	if (!value || typeof value !== "object") return value;
	return sanitizePlainObject(value);
}
function summarizeTextValue(value) {
	if (typeof value === "string") return {
		omitted: CONTENT_OMITTED,
		length: value.length
	};
	if (Array.isArray(value)) return {
		omitted: CONTENT_OMITTED,
		count: value.length
	};
	if (value && typeof value === "object") return {
		omitted: CONTENT_OMITTED,
		kind: "object"
	};
	return value;
}
function summarizeUrlValue(value) {
	if (typeof value === "string" && value.trim().length > 0) return {
		omitted: CONTENT_OMITTED,
		kind: "url"
	};
	return sanitizeValue(value);
}
function summarizeAttachmentCollection(value) {
	if (!Array.isArray(value)) return summarizeTextValue(value);
	return {
		count: value.length,
		items: value.map((entry) => summarizeAttachmentValue(entry))
	};
}
function summarizeAttachmentValue(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return summarizeTextValue(value);
	const record = value;
	return removeUndefinedFields({
		filename: normalizeString(record.filename) ?? normalizeString(record.fileName) ?? void 0,
		mime: normalizeString(record.mime) ?? normalizeString(record.mimeType) ?? void 0,
		sizeBytes: pickNumericValue(record, [
			"sizeBytes",
			"size",
			"fileSize"
		]),
		hasCaption: pickStringValue(record, ["caption"]) !== null,
		textLength: pickStringValue(record, ["text", "prompt"])?.length,
		type: normalizeString(record.type) ?? void 0
	});
}
function isSensitiveKey(key) {
	return /token|secret|api[-_]?key|authorization|password|cookie/iu.test(key);
}
function isTextContentKey(key) {
	return /(^|[-_])(text|prompt|caption|body|markdown|content|messageText|fallbackText|input|raw)$/iu.test(key) || /bodyMd|bodyText|messageText|fallbackText/iu.test(key);
}
function isUrlLikeKey(key) {
	return /(^|[-_])(url|uri|href|filePath|downloadPath|downloadUrl|fileUrl)$/iu.test(key);
}
function isAttachmentCollectionKey(key) {
	return /(^|[-_])(files|parts|attachments)$/iu.test(key);
}
function redactSensitiveFieldValue(value) {
	if (typeof value === "string" && value.trim().length > 0) return REDACTED;
	if (Array.isArray(value)) return value.map(() => REDACTED);
	if (value && typeof value === "object") return REDACTED;
	return value;
}
function removeUndefinedFields(record) {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== void 0));
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizeString(value) {
	return typeof value === "string" && value.trim().length > 0 ? redactSensitiveText(value.trim()) : null;
}
function pickNumericValue(record, keys) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number") return value;
	}
}
function pickStringValue(record, keys) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return null;
}
function sanitizeFileSegment(value) {
	return value.replace(/[^a-z0-9._-]+/giu, "_");
}
function normalizeStructuredLogErrorRecord(value) {
	return {
		name: normalizeString(value.name) ?? "Error",
		message: normalizeString(value.message) ?? "Unknown error",
		...typeof value.stack === "string" ? { stack: redactSensitiveText(value.stack) } : {},
		...value.data !== void 0 ? { data: sanitizeValue(value.data) } : {}
	};
}
//#endregion
//#region src/repositories/pending-action.repo.ts
var FilePendingActionRepository = class {
	constructor(store) {
		this.store = store;
	}
	async getByChatId(chatId) {
		return (await this.store.read()).pendingActions[String(chatId)] ?? null;
	}
	async set(action) {
		await this.store.update((state) => {
			state.pendingActions[String(action.chatId)] = action;
		});
	}
	async clear(chatId) {
		await this.store.update((state) => {
			delete state.pendingActions[String(chatId)];
		});
	}
};
//#endregion
//#region src/repositories/permission-approval.repo.ts
function buildApprovalKey(requestId, chatId) {
	return `${requestId}:${chatId}`;
}
var FilePermissionApprovalRepository = class {
	constructor(store) {
		this.store = store;
	}
	async listByRequestId(requestId) {
		const state = await this.store.read();
		return Object.values(state.pendingPermissions).filter((approval) => approval.requestId === requestId);
	}
	async set(approval) {
		await this.store.update((state) => {
			state.pendingPermissions[buildApprovalKey(approval.requestId, approval.chatId)] = approval;
		});
	}
};
//#endregion
//#region src/repositories/session.repo.ts
var FileSessionRepository = class {
	constructor(store) {
		this.store = store;
	}
	async getByChatId(chatId) {
		return (await this.store.read()).sessions[String(chatId)] ?? null;
	}
	async listBySessionId(sessionId) {
		const state = await this.store.read();
		return Object.values(state.sessions).filter((binding) => binding.sessionId === sessionId);
	}
	async setCurrent(binding) {
		await this.store.update((state) => {
			state.sessions[String(binding.chatId)] = binding;
		});
	}
	async touch(chatId) {
		await this.store.update((state) => {
			const current = state.sessions[String(chatId)];
			if (!current) return;
			state.sessions[String(chatId)] = {
				...current,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
		});
	}
};
//#endregion
//#region src/repositories/token-settings.repo.ts
var FileTokenSettingsRepository = class {
	settings;
	writeQueue = Promise.resolve();
	constructor(configFilePath, initialSettings) {
		this.configFilePath = configFilePath;
		this.settings = normalizeTokenSettings(initialSettings);
	}
	async get() {
		return { showBreakdown: this.settings.showBreakdown };
	}
	async set(settings) {
		const normalizedSettings = normalizeTokenSettings(settings);
		const nextWrite = this.writeQueue.then(async () => {
			const nextConfig = mergePluginConfigSources(sanitizeDeprecatedTokenConfig(await loadPluginConfigFile(this.configFilePath)), { tokens: { showBreakdown: normalizedSettings.showBreakdown } });
			await writePluginConfigFile(this.configFilePath, nextConfig);
			this.settings = normalizedSettings;
		});
		this.writeQueue = nextWrite.then(() => void 0, () => void 0);
		await nextWrite;
	}
};
function normalizeTokenSettings(settings) {
	return { showBreakdown: settings.showBreakdown === true };
}
function sanitizeDeprecatedTokenConfig(config) {
	if (!config.tokens || typeof config.tokens !== "object" || Array.isArray(config.tokens)) return config;
	const nextTokens = { ...config.tokens };
	delete nextTokens.totalIncludes;
	return {
		...config,
		tokens: nextTokens
	};
}
//#endregion
//#region src/infra/utils/markdown-text.ts
var HTML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/g;
function stripMarkdownToPlainText(markdown) {
	const lines = preprocessMarkdownForPlainText(markdown).split("\n");
	const rendered = [];
	for (let index = 0; index < lines.length; index += 1) {
		const tableBlock = consumeMarkdownTable$1(lines, index);
		if (tableBlock) {
			rendered.push(renderTableAsPlainText(tableBlock.rows));
			index = tableBlock.nextIndex - 1;
			continue;
		}
		rendered.push(lines[index] ?? "");
	}
	return rendered.join("\n").replace(/```[A-Za-z0-9_-]*\n?/g, "").replace(/```/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*>\s?/gm, "").replace(/^(\s*)[-+*]\s+/gm, "$1- ").replace(/^(\s*)(\d+)[.)]\s+/gm, "$1$2. ").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(.*?)\1/g, "$2").replace(/`([^`]+)`/g, "$1").replace(HTML_TAG_PATTERN, "").trim();
}
function preprocessMarkdownForPlainText(markdown) {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const processed = [];
	let activeFence = null;
	for (const line of lines) {
		const fenceMatch = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
		if (fenceMatch) {
			const language = (fenceMatch[1] ?? "").toLowerCase();
			if (activeFence === "markdown") {
				activeFence = null;
				continue;
			}
			if (activeFence === "plain") {
				processed.push(line);
				activeFence = null;
				continue;
			}
			if (language === "md" || language === "markdown") {
				activeFence = "markdown";
				continue;
			}
			activeFence = "plain";
			processed.push(line);
			continue;
		}
		processed.push(line);
	}
	return processed.join("\n");
}
function consumeMarkdownTable$1(lines, startIndex) {
	if (startIndex + 1 >= lines.length) return null;
	const headerCells = parseMarkdownTableRow$1(lines[startIndex] ?? "");
	const separatorCells = parseMarkdownTableSeparator$1(lines[startIndex + 1] ?? "");
	if (!headerCells || !separatorCells || headerCells.length !== separatorCells.length) return null;
	const rows = [headerCells];
	let index = startIndex + 2;
	while (index < lines.length) {
		const rowCells = parseMarkdownTableRow$1(lines[index] ?? "");
		if (!rowCells || rowCells.length !== headerCells.length) break;
		rows.push(rowCells);
		index += 1;
	}
	return {
		rows,
		nextIndex: index
	};
}
function parseMarkdownTableRow$1(line) {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) return null;
	const cells = splitMarkdownTableCells$1(trimmed).map((cell) => normalizeTableCell$1(cell));
	return cells.length >= 2 ? cells : null;
}
function parseMarkdownTableSeparator$1(line) {
	const cells = splitMarkdownTableCells$1(line.trim());
	if (cells.length < 2) return null;
	return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim())) ? cells : null;
}
function splitMarkdownTableCells$1(line) {
	const content = line.replace(/^\|/, "").replace(/\|$/, "");
	const cells = [];
	let current = "";
	let escaped = false;
	for (const char of content) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			current += char;
			continue;
		}
		if (char === "|") {
			cells.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current);
	return cells;
}
function normalizeTableCell$1(cell) {
	return cell.trim().replace(/\\\|/g, "|").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(.*?)\1/g, "$2").replace(/`([^`]+)`/g, "$1").replace(HTML_TAG_PATTERN, "");
}
function renderTableAsPlainText(rows) {
	return buildAlignedTableLines$1(rows).join("\n");
}
function buildAlignedTableLines$1(rows) {
	const columnWidths = calculateTableColumnWidths$1(rows);
	return [
		formatTableRow$1(rows[0] ?? [], columnWidths),
		columnWidths.map((width) => "-".repeat(Math.max(3, width))).join("-+-"),
		...rows.slice(1).map((row) => formatTableRow$1(row, columnWidths))
	];
}
function calculateTableColumnWidths$1(rows) {
	return (rows[0] ?? []).map((_, columnIndex) => rows.reduce((maxWidth, row) => Math.max(maxWidth, getDisplayWidth$1(row[columnIndex] ?? "")), 0));
}
function formatTableRow$1(row, columnWidths) {
	return row.map((cell, index) => padDisplayWidth$1(cell, columnWidths[index] ?? 0)).join(" | ");
}
function padDisplayWidth$1(value, targetWidth) {
	const padding = Math.max(0, targetWidth - getDisplayWidth$1(value));
	return `${value}${" ".repeat(padding)}`;
}
function getDisplayWidth$1(value) {
	let width = 0;
	for (const char of value) width += isWideCharacter$1(char.codePointAt(0) ?? 0) ? 2 : 1;
	return width;
}
function isWideCharacter$1(codePoint) {
	return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510);
}
//#endregion
//#region src/services/opencode/opencode.client.ts
function buildOpenCodeSdkConfig(options) {
	const apiKey = options.apiKey?.trim();
	return {
		baseUrl: options.baseUrl,
		...apiKey ? { auth: apiKey } : {}
	};
}
var OpenCodePromptTimeoutError = class extends Error {
	data;
	constructor(data) {
		super(data.message ?? "OpenCode prompt timed out.");
		this.name = "OpenCodePromptTimeoutError";
		this.data = data;
	}
};
var OpenCodeMessageAbortedError = class extends Error {
	data;
	constructor(message = "Request was aborted.") {
		super(message);
		this.name = "MessageAbortedError";
		this.data = { message };
	}
};
function createMessageAbortedError(message = "Request was aborted.") {
	return new OpenCodeMessageAbortedError(message);
}
var EMPTY_RESPONSE_TEXT = "OpenCode returned empty response.";
var PROMPT_MESSAGE_POLL_INITIAL_DELAYS_MS = [
	0,
	100,
	250,
	500,
	1e3
];
var PROMPT_MESSAGE_POLL_INTERVAL_MS = 2e3;
var PROMPT_MESSAGE_POLL_LIMIT = 20;
var PROMPT_LOG_SERVICE = "opencode-tbot";
var DEFAULT_OPENCODE_PROMPT_TIMEOUT_POLICY = {
	pollRequestTimeoutMs: 15e3,
	recoveryInactivityTimeoutMs: 12e4,
	waitTimeoutMs: 18e5
};
var SDK_OPTIONS = {
	responseStyle: "data",
	throwOnError: true
};
var OpenCodeClient = class {
	client;
	promptTimeoutPolicy;
	modelCache = {
		expiresAt: 0,
		promise: null,
		value: null
	};
	constructor(options, client, promptTimeoutPolicy = {}) {
		if (!options && !client) throw new Error("OpenCodeClient requires either base URL options or an injected SDK client.");
		this.client = client ?? createOpencodeClient(buildOpenCodeSdkConfig(options));
		this.promptTimeoutPolicy = resolvePromptTimeoutPolicy(promptTimeoutPolicy);
	}
	configurePromptTimeoutPolicy(promptTimeoutPolicy) {
		this.promptTimeoutPolicy = resolvePromptTimeoutPolicy({
			...this.promptTimeoutPolicy,
			...promptTimeoutPolicy
		});
	}
	buildSdkOptions(signal) {
		return {
			...SDK_OPTIONS,
			...signal ? { signal } : {}
		};
	}
	buildSdkRequest(request, signal) {
		return {
			...request,
			...this.buildSdkOptions(signal)
		};
	}
	async callSdkMethod(operation, request, signal) {
		return unwrapSdkData(await operation(this.buildSdkRequest(request, signal)));
	}
	async callSdkOptionsOnlyMethod(operation, signal) {
		return unwrapSdkData(await operation(this.buildSdkOptions(signal)));
	}
	async getHealth() {
		const rawGet = resolveSdkRawGetOperation(this.client);
		if (rawGet) return unwrapSdkData(await rawGet({
			url: "/global/health",
			...this.buildSdkOptions()
		}));
		throw new Error("Root @opencode-ai/sdk does not expose /global/health through a typed helper.");
	}
	async abortSession(sessionId) {
		return this.callSdkMethod(this.client.session.abort.bind(this.client.session), { path: { id: sessionId } });
	}
	async deleteSession(sessionId) {
		return this.callSdkMethod(this.client.session.delete.bind(this.client.session), { path: { id: sessionId } });
	}
	async forkSession(sessionId, messageId) {
		return this.callSdkMethod(this.client.session.fork.bind(this.client.session), {
			path: { id: sessionId },
			...messageId?.trim() ? { body: { messageID: messageId.trim() } } : {}
		});
	}
	async getPath() {
		return this.callSdkOptionsOnlyMethod(this.client.path.get.bind(this.client.path));
	}
	async listLspStatuses(directory) {
		return directory ? this.callSdkMethod(this.client.lsp.status.bind(this.client.lsp), { query: { directory } }) : this.callSdkOptionsOnlyMethod(this.client.lsp.status.bind(this.client.lsp));
	}
	async listMcpStatuses(directory) {
		return directory ? this.callSdkMethod(this.client.mcp.status.bind(this.client.mcp), { query: { directory } }) : this.callSdkOptionsOnlyMethod(this.client.mcp.status.bind(this.client.mcp));
	}
	async getSessionStatuses() {
		return this.loadSessionStatuses();
	}
	async listProjects() {
		return this.callSdkOptionsOnlyMethod(this.client.project.list.bind(this.client.project));
	}
	async listSessions() {
		return this.callSdkOptionsOnlyMethod(this.client.session.list.bind(this.client.session));
	}
	async getCurrentProject() {
		return this.callSdkOptionsOnlyMethod(this.client.project.current.bind(this.client.project));
	}
	async createSessionForDirectory(directory, title) {
		return this.callSdkMethod(this.client.session.create.bind(this.client.session), {
			query: { directory },
			...title ? { body: { title } } : {}
		});
	}
	async renameSession(sessionId, title) {
		return this.callSdkMethod(this.client.session.update.bind(this.client.session), {
			path: { id: sessionId },
			body: { title }
		});
	}
	async listAgents() {
		return this.callSdkOptionsOnlyMethod(this.client.app.agents.bind(this.client.app));
	}
	async replyToPermission(sessionId, requestId, reply) {
		return this.callSdkMethod(this.client.postSessionIdPermissionsPermissionId.bind(this.client), {
			path: {
				id: sessionId,
				permissionID: requestId
			},
			body: { response: reply }
		});
	}
	async listModels() {
		const now = Date.now();
		if (this.modelCache.value && this.modelCache.expiresAt > now) return this.modelCache.value;
		if (this.modelCache.promise) return this.modelCache.promise;
		const refreshPromise = this.loadModels().finally(() => {
			if (this.modelCache.promise === refreshPromise) this.modelCache.promise = null;
		});
		this.modelCache.promise = refreshPromise;
		return refreshPromise;
	}
	async listConfiguredPlugins() {
		return normalizeConfiguredPluginSpecs((await this.loadConfig()).plugin);
	}
	async promptSession(input) {
		const startedAt = Date.now();
		const promptText = input.prompt?.trim() ?? "";
		const parts = [...promptText ? [{
			type: "text",
			text: promptText
		}] : [], ...(input.files ?? []).map((file) => ({
			type: "file",
			filename: file.filename,
			mime: file.mime,
			url: file.url
		}))];
		if (parts.length === 0) throw new Error("Prompt requires text or file attachments.");
		throwIfAborted(input.signal);
		const knownMessageIds = await this.captureKnownMessageIds(input.sessionId, input.signal);
		await this.sendPromptRequest(input, parts);
		return buildPromptSessionResult(await this.resolvePromptResponse(input, null, knownMessageIds, startedAt), {
			emptyResponseText: EMPTY_RESPONSE_TEXT,
			finishedAt: Date.now(),
			startedAt
		});
	}
	async resolvePromptResponse(input, data, knownMessageIds, startedAt) {
		if (data && shouldReturnPromptResponseImmediately(data)) return data;
		const messageId = data ? extractMessageId(data.info) : null;
		const candidateOptions = {
			initialMessageId: messageId,
			initialParentId: data ? toAssistantMessage(data.info)?.parentID ?? null : null,
			knownMessageIds,
			requestStartedAt: resolvePromptCandidateStartTime(startedAt, data)
		};
		let bestCandidate = selectPromptResponseCandidate(data ? [data] : [], candidateOptions);
		let lastProgressAt = Date.now();
		let lastStatus = null;
		const deadlineAt = startedAt + this.promptTimeoutPolicy.waitTimeoutMs;
		let idleStatusSeen = false;
		let attempt = 0;
		while (true) {
			throwIfAborted(input.signal);
			const remainingWaitMs = deadlineAt - Date.now();
			const remainingInactivityMs = this.promptTimeoutPolicy.recoveryInactivityTimeoutMs - (Date.now() - lastProgressAt);
			if (remainingWaitMs <= 0 || remainingInactivityMs <= 0) break;
			const delayMs = getPromptMessagePollDelayMs(attempt);
			attempt += 1;
			if (delayMs > 0) {
				const remainingMs = Math.min(remainingWaitMs, remainingInactivityMs);
				if (remainingMs <= 0) break;
				await delay(Math.min(delayMs, remainingMs), input.signal);
			}
			if (messageId) {
				const next = await this.fetchPromptMessage(input.sessionId, messageId, input.signal);
				if (next) {
					const nextCandidate = selectPromptResponseCandidate([bestCandidate, next], candidateOptions);
					if (nextCandidate) {
						if (didPromptResponseAdvance(bestCandidate, nextCandidate)) {
							lastProgressAt = Date.now();
							idleStatusSeen = false;
						}
						bestCandidate = nextCandidate;
					}
					if (bestCandidate && isPromptResponseForCurrentRequest(bestCandidate, candidateOptions) && shouldReturnPromptResponseImmediately(bestCandidate)) return bestCandidate;
				}
			}
			const latest = await this.findLatestPromptResponse(input.sessionId, candidateOptions, "poll-messages", input.signal);
			if (latest) {
				const nextCandidate = selectPromptResponseCandidate([bestCandidate, latest], candidateOptions);
				if (nextCandidate) {
					if (didPromptResponseAdvance(bestCandidate, nextCandidate)) {
						lastProgressAt = Date.now();
						idleStatusSeen = false;
					}
					bestCandidate = nextCandidate;
				}
				if (bestCandidate && isPromptResponseForCurrentRequest(bestCandidate, candidateOptions) && shouldReturnPromptResponseImmediately(bestCandidate)) return bestCandidate;
			}
			const status = await this.fetchPromptSessionStatus(input.sessionId, input.signal);
			lastStatus = status;
			if (status?.type === "busy" || status?.type === "retry") {
				lastProgressAt = Date.now();
				idleStatusSeen = false;
			} else if (status?.type === "idle") {
				if (idleStatusSeen) break;
				idleStatusSeen = true;
			}
			if (bestCandidate && isPromptResponseForCurrentRequest(bestCandidate, candidateOptions) && isCompletedEmptyPromptResponse(bestCandidate) && status?.type !== "busy" && status?.type !== "retry") break;
			if (Date.now() >= deadlineAt) break;
		}
		const latest = await this.findLatestPromptResponse(input.sessionId, candidateOptions, "final-scan", input.signal);
		const resolved = selectPromptResponseCandidate([bestCandidate, latest], candidateOptions);
		const requestScopedResolved = resolved && isPromptResponseForCurrentRequest(resolved, candidateOptions) ? resolved : null;
		if (lastStatus?.type === "idle" && (!requestScopedResolved || shouldPollPromptMessage(requestScopedResolved))) throw createMessageAbortedError();
		if (!requestScopedResolved || shouldPollPromptMessage(requestScopedResolved)) {
			const timeoutReason = Date.now() >= deadlineAt ? "max-wait" : "recovery-inactivity";
			const timeoutMs = timeoutReason === "max-wait" ? this.promptTimeoutPolicy.waitTimeoutMs : this.promptTimeoutPolicy.recoveryInactivityTimeoutMs;
			const error = createOpenCodePromptTimeoutError({
				sessionId: input.sessionId,
				stage: "final-scan",
				timeoutMs,
				messageId: messageId ?? void 0
			});
			this.logPromptRequest("warn", {
				lastProgressAt,
				messageId: messageId ?? void 0,
				sessionId: input.sessionId,
				stage: "final-scan",
				timeoutMs,
				timeoutReason
			}, "OpenCode prompt recovery timed out");
			throw error;
		}
		return requestScopedResolved;
	}
	async fetchPromptMessage(sessionId, messageId, signal) {
		try {
			return await this.runPromptRequestWithTimeout({
				sessionId,
				stage: "poll-message",
				timeoutMs: this.promptTimeoutPolicy.pollRequestTimeoutMs,
				messageId
			}, async (requestSignal) => {
				return normalizePromptResponse(await this.callSdkMethod(this.client.session.message.bind(this.client.session), { path: {
					id: sessionId,
					messageID: messageId
				} }, requestSignal));
			}, signal);
		} catch (error) {
			if (isPromptRequestAbort(error)) throw error;
			this.logPromptRequestFailure(error, {
				sessionId,
				stage: "poll-message",
				timeoutMs: this.promptTimeoutPolicy.pollRequestTimeoutMs,
				messageId
			});
			return null;
		}
	}
	async captureKnownMessageIds(sessionId, signal) {
		const messages = await this.fetchRecentPromptMessages(sessionId, "capture-known-messages", signal);
		if (!messages) return /* @__PURE__ */ new Set();
		return new Set(messages.map((message) => extractMessageId(message.info)).filter((id) => typeof id === "string" && id.length > 0));
	}
	async fetchRecentPromptMessages(sessionId, stage, signal) {
		try {
			return await this.runPromptRequestWithTimeout({
				sessionId,
				stage,
				timeoutMs: this.promptTimeoutPolicy.pollRequestTimeoutMs
			}, async (requestSignal) => {
				return normalizePromptResponses(await this.callSdkMethod(this.client.session.messages.bind(this.client.session), {
					path: { id: sessionId },
					query: { limit: PROMPT_MESSAGE_POLL_LIMIT }
				}, requestSignal));
			}, signal);
		} catch (error) {
			if (isPromptRequestAbort(error)) throw error;
			this.logPromptRequestFailure(error, {
				sessionId,
				stage,
				timeoutMs: this.promptTimeoutPolicy.pollRequestTimeoutMs
			});
			return null;
		}
	}
	async fetchPromptSessionStatus(sessionId, signal) {
		try {
			return (await this.runPromptRequestWithTimeout({
				sessionId,
				stage: "poll-status",
				timeoutMs: this.promptTimeoutPolicy.pollRequestTimeoutMs
			}, async (requestSignal) => this.loadSessionStatuses(requestSignal), signal))[sessionId] ?? null;
		} catch (error) {
			if (isPromptRequestAbort(error)) throw error;
			this.logPromptRequestFailure(error, {
				sessionId,
				stage: "poll-status",
				timeoutMs: this.promptTimeoutPolicy.pollRequestTimeoutMs
			});
			return null;
		}
	}
	async findLatestPromptResponse(sessionId, options, stage, signal) {
		const messages = await this.fetchRecentPromptMessages(sessionId, stage, signal);
		if (!messages || messages.length === 0) return null;
		return selectPromptResponseCandidate(messages, options);
	}
	async loadModels() {
		const [config, providerCatalog, connectedProviders] = await Promise.all([
			this.loadConfig(),
			this.loadProviderCatalog(),
			this.loadConnectedProviders()
		]);
		const models = buildSelectableModels(config, providerCatalog.providers, connectedProviders);
		this.modelCache = {
			expiresAt: Date.now() + 6e4,
			promise: null,
			value: models
		};
		return models;
	}
	async loadConfig() {
		return this.callSdkOptionsOnlyMethod(this.client.config.get.bind(this.client.config));
	}
	async loadProviderCatalog() {
		return this.callSdkOptionsOnlyMethod(this.client.config.providers.bind(this.client.config));
	}
	async loadConnectedProviders() {
		const providers = await this.callSdkOptionsOnlyMethod(this.client.provider.list.bind(this.client.provider));
		return new Set(providers.connected);
	}
	async sendPromptRequest(input, parts) {
		const requestBody = {
			...input.agent ? { agent: input.agent } : {},
			...input.model ? { model: input.model } : {},
			...input.variant ? { variant: input.variant } : {},
			parts
		};
		try {
			await this.runPromptRequestWithTimeout({
				sessionId: input.sessionId,
				stage: "send-prompt",
				timeoutMs: this.promptTimeoutPolicy.waitTimeoutMs
			}, async (signal) => {
				await this.callSdkMethod(this.client.session.promptAsync.bind(this.client.session), {
					path: { id: input.sessionId },
					body: requestBody
				}, signal);
			}, input.signal);
			return;
		} catch (error) {
			this.logPromptRequestFailure(error, {
				sessionId: input.sessionId,
				stage: "send-prompt",
				timeoutMs: this.promptTimeoutPolicy.waitTimeoutMs
			});
			throw error;
		}
	}
	async loadSessionStatuses(signal) {
		return this.callSdkOptionsOnlyMethod(this.client.session.status.bind(this.client.session), signal);
	}
	async runPromptRequestWithTimeout(input, operation, signal) {
		const startedAt = Date.now();
		const controller = new AbortController();
		const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
		let timeoutHandle = null;
		let removeAbortListener = () => void 0;
		const abortPromise = signal ? new Promise((_, reject) => {
			const onAbort = () => {
				reject(normalizeAbortReason(signal.reason));
			};
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
			removeAbortListener = () => {
				signal.removeEventListener("abort", onAbort);
			};
		}) : null;
		const timeoutPromise = new Promise((_, reject) => {
			timeoutHandle = setTimeout(() => {
				reject(createOpenCodePromptTimeoutError({
					sessionId: input.sessionId,
					stage: input.stage,
					timeoutMs: input.timeoutMs,
					messageId: input.messageId ?? void 0,
					elapsedMs: Date.now() - startedAt
				}));
				controller.abort();
			}, input.timeoutMs);
		});
		try {
			return await Promise.race([
				operation(requestSignal),
				timeoutPromise,
				...abortPromise ? [abortPromise] : []
			]);
		} finally {
			if (timeoutHandle !== null) clearTimeout(timeoutHandle);
			removeAbortListener();
		}
	}
	logPromptRequestFailure(error, input) {
		if (error instanceof OpenCodePromptTimeoutError) {
			this.logPromptRequest("warn", {
				endpointKind: resolvePromptEndpointKind(error.data.stage),
				elapsedMs: error.data.elapsedMs,
				messageId: error.data.messageId,
				sessionId: error.data.sessionId,
				stage: error.data.stage,
				timeoutMs: error.data.timeoutMs
			}, "OpenCode prompt request timed out");
			return;
		}
		this.logPromptRequest("warn", {
			endpointKind: resolvePromptEndpointKind(input.stage),
			error,
			messageId: input.messageId ?? void 0,
			sessionId: input.sessionId,
			stage: input.stage,
			timeoutMs: input.timeoutMs
		}, "OpenCode prompt request failed");
	}
	logPromptRequest(level, extra, message) {
		const log = this.client.app?.log;
		if (typeof log !== "function") return;
		const payload = {
			service: PROMPT_LOG_SERVICE,
			level,
			message,
			extra
		};
		log.call(this.client.app, {
			body: payload,
			...SDK_OPTIONS
		}).catch(() => void 0);
	}
};
function createOpenCodeClientFromSdkClient(client, promptTimeoutPolicy = {}) {
	return new OpenCodeClient(void 0, client, promptTimeoutPolicy);
}
function buildSelectableModels(config, providers, connectedProviders = /* @__PURE__ */ new Set()) {
	const configuredProviders = config.provider ?? {};
	const providersById = new Map(providers.map((provider) => [provider.id, provider]));
	const models = /* @__PURE__ */ new Map();
	for (const [providerId, providerConfig] of Object.entries(configuredProviders)) {
		if (!connectedProviders.has(providerId)) continue;
		const configuredModels = providerConfig.models ?? {};
		for (const [configuredModelKey, modelConfig] of Object.entries(configuredModels)) {
			const model = buildConfiguredModel(providerId, providerConfig, configuredModelKey, modelConfig, providersById.get(providerId));
			if (model) models.set(model.qualifiedId, model);
		}
	}
	for (const provider of providers) {
		if (!connectedProviders.has(provider.id)) continue;
		for (const model of buildCatalogProviderModels(provider)) if (!models.has(model.qualifiedId)) models.set(model.qualifiedId, model);
	}
	return [...models.values()];
}
function buildConfiguredModel(providerId, providerConfig, configuredModelKey, modelConfig, providerCatalog) {
	const modelId = modelConfig.id ?? configuredModelKey;
	const catalogModel = providerCatalog?.models[modelId];
	if (!isTextModel(modelConfig, catalogModel)) return null;
	return {
		id: modelId,
		providerID: providerId,
		providerName: resolveProviderDisplayName(providerId, providerConfig, providerCatalog),
		name: modelConfig.name ?? catalogModel?.name ?? modelId,
		qualifiedId: `${providerId}/${modelId}`,
		reasoning: modelConfig.reasoning ?? catalogModel?.capabilities.reasoning ?? false,
		variants: normalizeVariants(readModelVariants(modelConfig) ?? readModelVariants(catalogModel))
	};
}
function buildCatalogProviderModels(provider) {
	return Object.values(provider.models).filter((model) => isCatalogTextModel(model)).map((model) => ({
		id: model.id,
		providerID: provider.id,
		providerName: provider.name,
		name: model.name,
		qualifiedId: `${provider.id}/${model.id}`,
		reasoning: model.capabilities.reasoning,
		variants: normalizeVariants(readModelVariants(model))
	}));
}
function isTextModel(modelConfig, catalogModel) {
	if (modelConfig.modalities) return modelConfig.modalities.input.includes("text") && modelConfig.modalities.output.includes("text");
	if (catalogModel) return catalogModel.capabilities.input.text && catalogModel.capabilities.output.text;
	return true;
}
function isCatalogTextModel(catalogModel) {
	return catalogModel.capabilities.input.text && catalogModel.capabilities.output.text;
}
function resolveProviderDisplayName(providerId, providerConfig, providerCatalog) {
	if (providerConfig.name) return providerConfig.name;
	const configuredBaseUrl = extractConfiguredBaseUrl(providerConfig);
	if (configuredBaseUrl) {
		const host = safeParseUrlHost(configuredBaseUrl);
		const label = providerCatalog?.name ?? providerId;
		return host ? `${label} (${host})` : label;
	}
	return providerCatalog?.name ?? providerId;
}
function extractConfiguredBaseUrl(providerConfig) {
	const options = providerConfig.options;
	if (!options || typeof options !== "object") return null;
	const baseUrl = "baseURL" in options ? options.baseURL : null;
	return typeof baseUrl === "string" && baseUrl.trim().length > 0 ? baseUrl.trim() : null;
}
function safeParseUrlHost(value) {
	try {
		return new URL(value).host || null;
	} catch {
		return null;
	}
}
function normalizeVariants(variants) {
	if (!variants || !isPlainRecord$1(variants)) return {};
	return Object.fromEntries(Object.entries(variants).filter(([, config]) => !isPlainRecord$1(config) || config.disabled !== true).map(([variant, config]) => {
		if (!isPlainRecord$1(config)) return [variant, {}];
		return [variant, Object.fromEntries(Object.entries(config).filter(([key]) => key !== "disabled"))];
	}));
}
function readModelVariants(value) {
	if (!isPlainRecord$1(value) || !isPlainRecord$1(value.variants)) return null;
	return value.variants;
}
function extractTextFromParts(parts) {
	if (!Array.isArray(parts)) return "";
	return parts.filter((part) => part.type === "text").map((part) => part.text).join("").trim();
}
function buildPromptSessionResult(data, options) {
	const assistantInfo = toAssistantMessage(data.info);
	const responseParts = Array.isArray(data.parts) ? data.parts : [];
	const bodyMd = extractTextFromParts(responseParts) || null;
	const fallbackText = bodyMd ? stripMarkdownToPlainText(bodyMd) || bodyMd : options.emptyResponseText;
	return {
		assistantError: assistantInfo?.error ?? null,
		bodyMd,
		fallbackText,
		info: assistantInfo,
		metrics: extractPromptMetrics(assistantInfo, options.startedAt, options.finishedAt),
		parts: responseParts,
		structured: null
	};
}
function shouldPollPromptMessage(data) {
	const assistantInfo = toAssistantMessage(data.info);
	const hasText = extractTextFromParts(Array.isArray(data.parts) ? data.parts : []).length > 0;
	const hasAssistantError = !!assistantInfo?.error;
	const isCompleted = isAssistantMessageCompleted(assistantInfo);
	return !hasText && !hasAssistantError && !isCompleted;
}
function shouldReturnPromptResponseImmediately(data) {
	return !shouldPollPromptMessage(data) && !isCompletedEmptyPromptResponse(data);
}
function isPromptResponseUsable(data) {
	return !shouldPollPromptMessage(data) && !isCompletedEmptyPromptResponse(data);
}
function normalizePromptResponse(response) {
	return {
		info: isPlainRecord$1(response?.info) ? response.info : null,
		parts: normalizePromptParts(response?.parts)
	};
}
function normalizePromptResponses(responses) {
	if (!Array.isArray(responses)) return null;
	return responses.map((response) => normalizePromptResponse(response));
}
function normalizePromptParts(parts) {
	return Array.isArray(parts) ? parts : [];
}
function toAssistantMessage(message) {
	if (!message || typeof message !== "object") return null;
	if ("role" in message && message.role !== "assistant") return null;
	const normalized = {};
	if ("agent" in message && typeof message.agent === "string" && message.agent.trim().length > 0) normalized.agent = message.agent;
	if ("cost" in message && typeof message.cost === "number" && Number.isFinite(message.cost)) normalized.cost = message.cost;
	const error = normalizeAssistantError("error" in message ? message.error : void 0);
	if (error) normalized.error = error;
	if ("finish" in message && typeof message.finish === "string" && message.finish.trim().length > 0) normalized.finish = message.finish;
	if ("id" in message && typeof message.id === "string" && message.id.trim().length > 0) normalized.id = message.id;
	if ("mode" in message && typeof message.mode === "string" && message.mode.trim().length > 0) normalized.mode = message.mode;
	if ("modelID" in message && typeof message.modelID === "string" && message.modelID.trim().length > 0) normalized.modelID = message.modelID;
	if ("parentID" in message && typeof message.parentID === "string" && message.parentID.trim().length > 0) normalized.parentID = message.parentID;
	if ("path" in message && isPlainRecord$1(message.path)) normalized.path = {
		...typeof message.path.cwd === "string" && message.path.cwd.trim().length > 0 ? { cwd: message.path.cwd } : {},
		...typeof message.path.root === "string" && message.path.root.trim().length > 0 ? { root: message.path.root } : {}
	};
	if ("providerID" in message && typeof message.providerID === "string" && message.providerID.trim().length > 0) normalized.providerID = message.providerID;
	if ("role" in message && message.role === "assistant") normalized.role = "assistant";
	if ("sessionID" in message && typeof message.sessionID === "string" && message.sessionID.trim().length > 0) normalized.sessionID = message.sessionID;
	if ("summary" in message && typeof message.summary === "boolean") normalized.summary = message.summary;
	if ("time" in message && isPlainRecord$1(message.time)) normalized.time = {
		...typeof message.time.created === "number" && Number.isFinite(message.time.created) ? { created: message.time.created } : {},
		...typeof message.time.completed === "number" && Number.isFinite(message.time.completed) ? { completed: message.time.completed } : {}
	};
	if ("tokens" in message && isPlainRecord$1(message.tokens)) normalized.tokens = {
		...typeof message.tokens.input === "number" && Number.isFinite(message.tokens.input) ? { input: message.tokens.input } : {},
		...typeof message.tokens.output === "number" && Number.isFinite(message.tokens.output) ? { output: message.tokens.output } : {},
		...typeof message.tokens.reasoning === "number" && Number.isFinite(message.tokens.reasoning) ? { reasoning: message.tokens.reasoning } : {},
		...typeof message.tokens.total === "number" && Number.isFinite(message.tokens.total) ? { total: message.tokens.total } : {},
		...isPlainRecord$1(message.tokens.cache) ? { cache: {
			...typeof message.tokens.cache.read === "number" && Number.isFinite(message.tokens.cache.read) ? { read: message.tokens.cache.read } : {},
			...typeof message.tokens.cache.write === "number" && Number.isFinite(message.tokens.cache.write) ? { write: message.tokens.cache.write } : {}
		} } : {}
	};
	if ("variant" in message && typeof message.variant === "string" && message.variant.trim().length > 0) normalized.variant = message.variant;
	return normalized;
}
function extractMessageId(message) {
	if (!isPlainRecord$1(message)) return null;
	return typeof message.id === "string" && message.id.trim().length > 0 ? message.id : null;
}
function delay(ms, signal) {
	return new Promise((resolve, reject) => {
		const handle = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(handle);
			signal?.removeEventListener("abort", onAbort);
			reject(normalizeAbortReason(signal?.reason));
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
function didPromptResponseAdvance(previous, next) {
	return getPromptResponseProgressSignature(previous) !== getPromptResponseProgressSignature(next);
}
function createOpenCodePromptTimeoutError(input) {
	return new OpenCodePromptTimeoutError({
		...input,
		elapsedMs: input.elapsedMs ?? input.timeoutMs,
		message: input.message ?? "The OpenCode host did not finish this request in time."
	});
}
function resolvePromptEndpointKind(stage) {
	switch (stage) {
		case "capture-known-messages":
		case "poll-messages":
		case "final-scan": return "messages";
		case "poll-message": return "message";
		case "poll-status": return "status";
		default: return "prompt";
	}
}
function resolveSdkRawGetOperation(client) {
	const compatibleClient = client;
	const transport = compatibleClient.client ?? compatibleClient._client;
	const operation = transport?.get;
	return typeof operation === "function" ? operation.bind(transport) : null;
}
function getPromptMessagePollDelayMs(attempt) {
	return PROMPT_MESSAGE_POLL_INITIAL_DELAYS_MS[attempt] ?? PROMPT_MESSAGE_POLL_INTERVAL_MS;
}
function extractPromptMetrics(info, startedAt, finishedAt) {
	const createdAt = typeof info?.time?.created === "number" && Number.isFinite(info.time.created) ? info.time.created : null;
	const completedAt = typeof info?.time?.completed === "number" && Number.isFinite(info.time.completed) ? info.time.completed : null;
	const completedDuration = createdAt !== null && completedAt !== null ? completedAt - createdAt : null;
	return {
		durationMs: completedDuration !== null && completedDuration >= 0 ? completedDuration : Math.max(0, finishedAt - startedAt),
		tokens: extractTokenMetrics(info)
	};
}
function extractTokenMetrics(info) {
	if (!info?.tokens) return {
		total: null,
		input: null,
		output: null,
		reasoning: null,
		cacheRead: null,
		cacheWrite: null
	};
	const input = coerceFiniteNumber(info.tokens.input);
	const output = coerceFiniteNumber(info.tokens.output);
	const reasoning = coerceFiniteNumber(info.tokens.reasoning);
	const cacheRead = coerceFiniteNumber(info.tokens.cache?.read);
	const cacheWrite = coerceFiniteNumber(info.tokens.cache?.write);
	const total = coerceFiniteNumber(info.tokens.total);
	const fallbackTotal = sumTokenMetrics(input, output, cacheRead, cacheWrite);
	return {
		total: total ?? fallbackTotal,
		input,
		output,
		reasoning,
		cacheRead,
		cacheWrite
	};
}
function coerceFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function sumTokenMetrics(...values) {
	if (values.every((value) => value === null)) return null;
	const total = values.reduce((sum, value) => sum + (value ?? 0), 0);
	return Number.isFinite(total) ? total : null;
}
function unwrapSdkData(response) {
	if (response && typeof response === "object" && "data" in response) return response.data;
	return response;
}
function normalizeConfiguredPluginSpecs(value) {
	if (!Array.isArray(value)) return [];
	const normalizedPlugins = [];
	const seenPlugins = /* @__PURE__ */ new Set();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const normalizedItem = item.trim();
		if (normalizedItem.length === 0 || seenPlugins.has(normalizedItem)) continue;
		seenPlugins.add(normalizedItem);
		normalizedPlugins.push(normalizedItem);
	}
	return normalizedPlugins;
}
function resolvePromptTimeoutPolicy(input) {
	return {
		pollRequestTimeoutMs: input.pollRequestTimeoutMs ?? DEFAULT_OPENCODE_PROMPT_TIMEOUT_POLICY.pollRequestTimeoutMs,
		recoveryInactivityTimeoutMs: input.recoveryInactivityTimeoutMs ?? DEFAULT_OPENCODE_PROMPT_TIMEOUT_POLICY.recoveryInactivityTimeoutMs,
		waitTimeoutMs: input.waitTimeoutMs ?? DEFAULT_OPENCODE_PROMPT_TIMEOUT_POLICY.waitTimeoutMs
	};
}
function normalizeAssistantError(value) {
	if (!isPlainRecord$1(value) || typeof value.name !== "string" || value.name.trim().length === 0) return;
	return {
		...value,
		name: value.name,
		...isPlainRecord$1(value.data) ? { data: value.data } : {}
	};
}
function isAssistantMessageCompleted(message) {
	return !!message?.error || typeof message?.time?.completed === "number" || typeof message?.finish === "string" && message.finish.trim().length > 0;
}
function isCompletedEmptyPromptResponse(data) {
	const assistantInfo = toAssistantMessage(data.info);
	const hasText = extractTextFromParts(Array.isArray(data.parts) ? data.parts : []).length > 0;
	return isAssistantMessageCompleted(assistantInfo) && !assistantInfo?.error && !hasText;
}
function selectPromptResponseCandidate(candidates, options) {
	const availableCandidates = candidates.filter((candidate) => !!candidate).filter((candidate) => toAssistantMessage(candidate.info) !== null);
	if (availableCandidates.length === 0) return null;
	return [...availableCandidates].sort((left, right) => comparePromptResponseCandidates(left, right, options))[0] ?? null;
}
function comparePromptResponseCandidates(left, right, options) {
	const leftRank = getPromptResponseCandidateRank(left, options);
	const rightRank = getPromptResponseCandidateRank(right, options);
	return Number(rightRank.isInitial) - Number(leftRank.isInitial) || Number(rightRank.sharesParent) - Number(leftRank.sharesParent) || Number(rightRank.isNewSinceRequestStart) - Number(leftRank.isNewSinceRequestStart) || Number(rightRank.isUsable) - Number(leftRank.isUsable) || rightRank.createdAt - leftRank.createdAt;
}
function getPromptResponseCandidateRank(message, options) {
	const assistant = toAssistantMessage(message.info);
	const id = assistant?.id ?? null;
	const createdAt = typeof assistant?.time?.created === "number" && Number.isFinite(assistant.time.created) ? assistant.time.created : 0;
	return {
		createdAt,
		isInitial: !!id && id === options.initialMessageId,
		isNewSinceRequestStart: isPromptResponseNewSinceRequestStart(id, createdAt, options.knownMessageIds, options.requestStartedAt),
		isUsable: isPromptResponseUsable(message),
		sharesParent: !!assistant?.parentID && assistant.parentID === options.initialParentId
	};
}
function resolvePromptCandidateStartTime(startedAt, initialMessage) {
	if (!initialMessage) return startedAt;
	const initialCreatedAt = coerceFiniteNumber(toAssistantMessage(initialMessage.info)?.time?.created);
	if (initialCreatedAt === null) return startedAt;
	return areComparablePromptTimestamps(startedAt, initialCreatedAt) ? startedAt : initialCreatedAt;
}
function getPromptResponseProgressSignature(response) {
	if (!response) return "null";
	const assistant = toAssistantMessage(response.info);
	const responseParts = Array.isArray(response.parts) ? response.parts : [];
	return JSON.stringify({
		assistantError: assistant?.error?.name ?? null,
		bodyMd: extractTextFromParts(responseParts) || null,
		completedAt: assistant?.time?.completed ?? null,
		finish: assistant?.finish ?? null,
		id: assistant?.id ?? null,
		partCount: responseParts.length,
		text: extractTextFromParts(responseParts)
	});
}
function isPromptResponseNewSinceRequestStart(messageId, createdAt, knownMessageIds, requestStartedAt) {
	if (!messageId || knownMessageIds.has(messageId)) return false;
	if (requestStartedAt === null) return true;
	return createdAt >= requestStartedAt;
}
function isPromptResponseForCurrentRequest(response, options) {
	const rank = getPromptResponseCandidateRank(response, options);
	return rank.isInitial || rank.sharesParent || rank.isNewSinceRequestStart;
}
function areComparablePromptTimestamps(left, right) {
	const epochThresholdMs = 0xe8d4a51000;
	return left >= epochThresholdMs && right >= epochThresholdMs;
}
function isPromptRequestAbort(error) {
	return error instanceof OpenCodeMessageAbortedError || error instanceof Error && error.name === "AbortError" || isNamedAbortError(error);
}
function isNamedAbortError(error) {
	return !!error && typeof error === "object" && "name" in error && error.name === "MessageAbortedError";
}
function normalizeAbortReason(reason) {
	if (reason instanceof Error || isNamedAbortError(reason)) return reason;
	return createMessageAbortedError();
}
function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	throw normalizeAbortReason(signal.reason);
}
function isPlainRecord$1(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
//#endregion
//#region src/services/storage/bot-state.ts
function createDefaultOpencodeTbotState() {
	return {
		version: 1,
		sessions: {},
		pendingActions: {},
		pendingPermissions: {}
	};
}
//#endregion
//#region src/services/storage/json-state-store.ts
var JsonStateStore = class {
	createDefaultState;
	filePath;
	statePromise = null;
	writeQueue = Promise.resolve();
	constructor(options) {
		this.createDefaultState = options.createDefaultState;
		this.filePath = options.filePath;
	}
	async read() {
		return cloneState(await this.loadState());
	}
	async update(mutator) {
		const nextStatePromise = this.writeQueue.then(async () => {
			const draft = cloneState(await this.loadState());
			mutator(draft);
			await writeStateFile(this.filePath, draft);
			this.statePromise = Promise.resolve(draft);
			return cloneState(draft);
		});
		this.writeQueue = nextStatePromise.then(() => void 0, () => void 0);
		return nextStatePromise;
	}
	async loadState() {
		if (!this.statePromise) this.statePromise = readStateFile(this.filePath, this.createDefaultState);
		return this.statePromise;
	}
};
async function readStateFile(filePath, createDefaultState) {
	try {
		const content = await readFile(filePath, "utf8");
		return JSON.parse(content);
	} catch (error) {
		if (isMissingFileError(error)) return createDefaultState();
		throw error;
	}
}
async function writeStateFile(filePath, state) {
	await mkdir(dirname(filePath), { recursive: true });
	const temporaryFilePath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await rename(temporaryFilePath, filePath);
}
function cloneState(state) {
	return JSON.parse(JSON.stringify(state));
}
function isMissingFileError(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
//#endregion
//#region src/services/telegram/telegram.client.ts
var TelegramFileDownloadError = class extends Error {
	data;
	constructor(message) {
		super(message);
		this.name = "TelegramFileDownloadError";
		this.data = { message };
	}
};
var TelegramFileClient = class {
	baseUrl;
	fetchFn;
	constructor(options, fetchFn = fetch) {
		this.baseUrl = options.baseUrl ?? buildTelegramFileApiRoot(options.apiRoot, options.botToken);
		this.fetchFn = fetchFn;
	}
	async downloadFile(input) {
		const filePath = input.filePath.trim();
		if (!filePath) throw new TelegramFileDownloadError("Telegram did not provide a downloadable file path.");
		let response;
		try {
			response = await this.fetchFn(new URL(filePath, this.baseUrl));
		} catch (error) {
			throw new TelegramFileDownloadError(extractErrorMessage(error) ?? "Failed to download the Telegram file.");
		}
		if (!response.ok) throw new TelegramFileDownloadError(await buildDownloadFailureMessage(response));
		const data = new Uint8Array(await response.arrayBuffer());
		if (data.byteLength === 0) throw new TelegramFileDownloadError("Telegram returned an empty file.");
		return {
			data,
			mimeType: response.headers.get("content-type")
		};
	}
};
function buildTelegramFileApiRoot(apiRoot, botToken) {
	return `${(apiRoot ?? "https://api.telegram.org").trim().replace(/\/+$/u, "")}/file/bot${botToken}/`;
}
async function buildDownloadFailureMessage(response) {
	const normalizedText = (await safeReadResponseText(response))?.trim();
	return normalizedText ? `Telegram file download failed with status ${response.status}: ${normalizedText}` : `Telegram file download failed with status ${response.status}.`;
}
async function safeReadResponseText(response) {
	try {
		const text = await response.text();
		return text.trim().length > 0 ? text : null;
	} catch {
		return null;
	}
}
function extractErrorMessage(error) {
	return error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : null;
}
//#endregion
//#region src/services/session-activity/foreground-session-tracker.ts
var ForegroundSessionTracker = class {
	requests = /* @__PURE__ */ new Map();
	sessionChats = /* @__PURE__ */ new Map();
	acquire(chatId) {
		if (this.requests.has(chatId)) return null;
		const state = {
			chatId,
			controller: new AbortController(),
			sessionId: null
		};
		this.requests.set(chatId, state);
		return {
			signal: state.controller.signal,
			attachSession: (sessionId) => {
				this.attachSession(chatId, sessionId);
			},
			dispose: () => {
				this.release(chatId);
			}
		};
	}
	abort(chatId, reason = createMessageAbortedError()) {
		const state = this.requests.get(chatId);
		if (!state) return false;
		if (!state.controller.signal.aborted) state.controller.abort(reason);
		return true;
	}
	begin(chatId, sessionId) {
		const lease = this.acquire(chatId);
		if (!lease) return () => void 0;
		lease.attachSession(sessionId);
		return () => {
			lease.dispose();
		};
	}
	clear(sessionId) {
		const chatIds = this.listChatIds(sessionId);
		if (chatIds.length === 0) return false;
		for (const chatId of chatIds) {
			const state = this.requests.get(chatId);
			if (state?.sessionId === sessionId) state.sessionId = null;
		}
		this.sessionChats.delete(sessionId);
		return true;
	}
	fail(sessionId, error) {
		const chatIds = this.listChatIds(sessionId);
		if (chatIds.length === 0) return false;
		this.clear(sessionId);
		for (const chatId of chatIds) this.abort(chatId, error);
		return true;
	}
	getActiveSessionId(chatId) {
		return this.requests.get(chatId)?.sessionId ?? null;
	}
	hasActiveRequest(chatId) {
		return this.requests.has(chatId);
	}
	isForeground(sessionId) {
		return this.sessionChats.has(sessionId);
	}
	listChatIds(sessionId) {
		return [...this.sessionChats.get(sessionId) ?? /* @__PURE__ */ new Set()];
	}
	attachSession(chatId, sessionId) {
		const normalizedSessionId = sessionId.trim();
		const state = this.requests.get(chatId);
		if (!state || normalizedSessionId.length === 0) return;
		if (state.sessionId === normalizedSessionId) return;
		if (state.sessionId) this.detachChatFromSession(chatId, state.sessionId);
		state.sessionId = normalizedSessionId;
		const chatIds = this.sessionChats.get(normalizedSessionId) ?? /* @__PURE__ */ new Set();
		chatIds.add(chatId);
		this.sessionChats.set(normalizedSessionId, chatIds);
	}
	release(chatId) {
		const state = this.requests.get(chatId);
		if (!state) return;
		if (state.sessionId) this.detachChatFromSession(chatId, state.sessionId);
		this.requests.delete(chatId);
	}
	detachChatFromSession(chatId, sessionId) {
		const chatIds = this.sessionChats.get(sessionId);
		if (!chatIds) return;
		chatIds.delete(chatId);
		if (chatIds.size === 0) {
			this.sessionChats.delete(sessionId);
			return;
		}
		this.sessionChats.set(sessionId, chatIds);
	}
};
var NOOP_FOREGROUND_SESSION_TRACKER = {
	acquire() {
		return null;
	},
	abort() {
		return false;
	},
	begin() {
		return () => void 0;
	},
	clear() {
		return false;
	},
	fail() {
		return false;
	},
	getActiveSessionId() {
		return null;
	},
	hasActiveRequest() {
		return false;
	},
	isForeground() {
		return false;
	},
	listChatIds() {
		return [];
	}
};
//#endregion
//#region src/use-cases/abort-prompt.usecase.ts
var AbortPromptUseCase = class {
	constructor(sessionRepo, opencodeClient, foregroundSessionTracker = NOOP_FOREGROUND_SESSION_TRACKER) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.foregroundSessionTracker = foregroundSessionTracker;
	}
	async execute(input) {
		const hasForegroundRequest = this.foregroundSessionTracker.hasActiveRequest(input.chatId);
		const activeSessionId = this.foregroundSessionTracker.getActiveSessionId(input.chatId);
		const binding = activeSessionId ? null : await this.sessionRepo.getByChatId(input.chatId);
		const sessionId = activeSessionId ?? binding?.sessionId ?? null;
		if (!hasForegroundRequest && !sessionId) return {
			sessionId: null,
			status: "no_session",
			sessionStatus: null
		};
		const sessionStatuses = sessionId ? await this.opencodeClient.getSessionStatuses() : {};
		const sessionStatus = sessionId ? sessionStatuses[sessionId] ?? null : null;
		if (hasForegroundRequest) {
			if (sessionId && sessionStatus && sessionStatus.type !== "idle") await this.opencodeClient.abortSession(sessionId);
			this.foregroundSessionTracker.abort(input.chatId, createMessageAbortedError());
			return {
				sessionId,
				status: "aborted",
				sessionStatus
			};
		}
		if (!sessionStatus || sessionStatus.type === "idle") return {
			sessionId,
			status: "not_running",
			sessionStatus
		};
		if (!sessionId) return {
			sessionId: null,
			status: "not_running",
			sessionStatus
		};
		const runningSessionId = sessionId;
		return {
			sessionId: runningSessionId,
			status: await this.opencodeClient.abortSession(runningSessionId) ? "aborted" : "not_running",
			sessionStatus
		};
	}
};
//#endregion
//#region src/use-cases/session-creation.ts
async function createAndBindCurrentProjectSession(sessionRepo, opencodeClient, input) {
	const binding = input.binding ?? await sessionRepo.getByChatId(input.chatId);
	const project = await opencodeClient.getCurrentProject();
	const title = normalizeOptionalText(input.title);
	const session = await opencodeClient.createSessionForDirectory(project.worktree, title ?? void 0);
	const nextBinding = {
		chatId: input.chatId,
		sessionId: session.id,
		projectId: session.projectID,
		directory: session.directory,
		agentName: binding?.agentName ?? null,
		modelProviderId: binding?.modelProviderId ?? null,
		modelId: binding?.modelId ?? null,
		modelVariant: binding?.modelVariant ?? null,
		language: binding?.language ?? null,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await sessionRepo.setCurrent(nextBinding);
	return {
		binding: nextBinding,
		project,
		session
	};
}
function normalizeOptionalText(value) {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}
//#endregion
//#region src/use-cases/create-session.usecase.ts
var CreateSessionUseCase = class {
	constructor(sessionRepo, opencodeClient, logger) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async execute(input) {
		const binding = await this.sessionRepo.getByChatId(input.chatId);
		const result = await createAndBindCurrentProjectSession(this.sessionRepo, this.opencodeClient, {
			chatId: input.chatId,
			title: input.title,
			binding
		});
		this.logger.info({
			chatId: input.chatId,
			sessionId: result.session.id,
			projectId: result.session.projectID,
			directory: result.session.directory,
			title: input.title?.trim() || null
		}, "session created");
		return { session: result.session };
	}
};
//#endregion
//#region src/use-cases/get-health.usecase.ts
var GetHealthUseCase = class {
	constructor(opencodeClient) {
		this.opencodeClient = opencodeClient;
	}
	async execute() {
		return this.opencodeClient.getHealth();
	}
};
//#endregion
//#region src/use-cases/get-path.usecase.ts
var GetPathUseCase = class {
	constructor(opencodeClient) {
		this.opencodeClient = opencodeClient;
	}
	async execute() {
		return this.opencodeClient.getPath();
	}
};
//#endregion
//#region src/use-cases/get-status.usecase.ts
var STATUS_SECTION_KEYS = [
	"health",
	"path",
	"plugins",
	"workspace",
	"lsp",
	"mcp"
];
var GetStatusUseCase = class {
	constructor(providers) {
		this.providers = providers;
	}
	async execute(input) {
		const sectionPromises = /* @__PURE__ */ new Map();
		const resolveSection = (key) => {
			const existingSectionPromise = sectionPromises.get(key);
			if (existingSectionPromise) return existingSectionPromise;
			const nextSectionPromise = this.providers[key].load(context);
			sectionPromises.set(key, nextSectionPromise);
			return nextSectionPromise;
		};
		const context = {
			chatId: input.chatId,
			resolve: resolveSection
		};
		await Promise.all(STATUS_SECTION_KEYS.map((key) => resolveSection(key)));
		return {
			health: await resolveSection("health"),
			path: await resolveSection("path"),
			plugins: await resolveSection("plugins"),
			workspace: await resolveSection("workspace"),
			lsp: await resolveSection("lsp"),
			mcp: await resolveSection("mcp")
		};
	}
};
function createStatusSectionProviders(input) {
	return {
		health: {
			key: "health",
			async load() {
				return loadStatusSection(async () => input.getHealthUseCase.execute());
			}
		},
		path: {
			key: "path",
			async load() {
				return loadStatusSection(async () => input.getPathUseCase.execute());
			}
		},
		plugins: {
			key: "plugins",
			async load(context) {
				const path = await context.resolve("path");
				if (path.status === "error") return {
					error: path.error,
					status: "error"
				};
				return loadStatusSection(async () => ({ plugins: normalizeConfiguredPluginLabels(await input.configuredPluginReader.listConfiguredPlugins()) }));
			}
		},
		workspace: {
			key: "workspace",
			async load(context) {
				const path = await context.resolve("path");
				if (path.status === "error") return {
					error: path.error,
					status: "error"
				};
				const binding = await input.sessionRepo.getByChatId(context.chatId);
				let currentProject = resolveWorkspaceProjectPath(path.data);
				let currentSession = binding?.sessionId ?? null;
				try {
					const sessions = await input.listSessionsUseCase.execute({ chatId: context.chatId });
					currentProject = resolveWorkspaceProjectPath(path.data, sessions.currentDirectory);
					currentSession = sessions.currentSessionId ? formatSessionStatusLabel(sessions.sessions.find((session) => session.id === sessions.currentSessionId) ?? null, sessions.currentSessionId) : null;
				} catch {}
				return {
					data: {
						currentProject,
						currentSession
					},
					status: "ok"
				};
			}
		},
		lsp: {
			key: "lsp",
			async load(context) {
				return loadStatusSection(async () => input.listLspUseCase.execute({ chatId: context.chatId }));
			}
		},
		mcp: {
			key: "mcp",
			async load(context) {
				return loadStatusSection(async () => input.listMcpUseCase.execute({ chatId: context.chatId }));
			}
		}
	};
}
async function loadStatusSection(load) {
	try {
		return {
			data: await load(),
			status: "ok"
		};
	} catch (error) {
		return {
			error,
			status: "error"
		};
	}
}
function formatSessionStatusLabel(session, fallbackId) {
	if (!session) return fallbackId;
	const slug = session.slug?.trim() || session.id;
	const title = session.title.trim() || slug || session.id;
	return title === slug ? title : `${title} (${slug})`;
}
function resolveWorkspaceProjectPath(path, preferredPath) {
	const candidates = [
		preferredPath,
		path.worktree,
		path.directory
	];
	for (const candidate of candidates) if (isUsableWorkspacePath(candidate)) return candidate;
	return preferredPath ?? path.worktree ?? path.directory;
}
function isUsableWorkspacePath(value) {
	if (typeof value !== "string") return false;
	const normalized = value.trim();
	return normalized.length > 0 && normalized !== "/" && normalized !== "\\" && isAbsolute(normalized);
}
function normalizeConfiguredPluginLabels(plugins) {
	const normalizedPlugins = [];
	const seenPlugins = /* @__PURE__ */ new Set();
	for (const plugin of plugins) {
		const normalizedPlugin = normalizeConfiguredPluginLabel(plugin);
		if (normalizedPlugin.length === 0 || seenPlugins.has(normalizedPlugin)) continue;
		seenPlugins.add(normalizedPlugin);
		normalizedPlugins.push(normalizedPlugin);
	}
	return normalizedPlugins;
}
function normalizeConfiguredPluginLabel(plugin) {
	return plugin.trim();
}
//#endregion
//#region src/use-cases/get-token-settings.usecase.ts
var GetTokenSettingsUseCase = class {
	constructor(tokenSettingsRepo) {
		this.tokenSettingsRepo = tokenSettingsRepo;
	}
	async execute() {
		return this.tokenSettingsRepo.get();
	}
};
function isSelectableAgent(agent) {
	return !agent.hidden && agent.mode !== "subagent";
}
function getSelectableAgents(agents) {
	return agents.filter((agent) => isSelectableAgent(agent));
}
function resolveSelectedAgent(agents, requestedAgentName) {
	const visibleAgents = getSelectableAgents(agents);
	if (requestedAgentName) {
		const requestedAgent = visibleAgents.find((agent) => agent.name === requestedAgentName);
		if (requestedAgent) return requestedAgent;
	}
	return visibleAgents.find((agent) => agent.name === "build") ?? null;
}
//#endregion
//#region src/use-cases/binding-update.ts
async function persistBindingUpdate(sessionRepo, binding, updates) {
	const nextBinding = {
		...binding,
		...updates,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	await sessionRepo.setCurrent(nextBinding);
	return nextBinding;
}
async function clearStoredAgentSelection(sessionRepo, binding) {
	return persistBindingUpdate(sessionRepo, binding, { agentName: null });
}
async function clearStoredModelSelection(sessionRepo, binding) {
	return persistBindingUpdate(sessionRepo, binding, {
		modelProviderId: null,
		modelId: null,
		modelVariant: null
	});
}
async function clearStoredModelVariant(sessionRepo, binding) {
	return persistBindingUpdate(sessionRepo, binding, { modelVariant: null });
}
async function clearStoredSessionContext(sessionRepo, binding) {
	return persistBindingUpdate(sessionRepo, binding, {
		sessionId: null,
		projectId: null,
		directory: null
	});
}
//#endregion
//#region src/use-cases/list-agents.usecase.ts
var ListAgentsUseCase = class {
	constructor(sessionRepo, opencodeClient) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
	}
	async execute(input) {
		let [binding, agents] = await Promise.all([this.sessionRepo.getByChatId(input.chatId), this.opencodeClient.listAgents()]);
		const visibleAgents = getSelectableAgents(agents);
		const currentAgent = resolveSelectedAgent(visibleAgents, binding?.agentName);
		if (binding?.agentName && currentAgent?.name !== binding.agentName) binding = await clearStoredAgentSelection(this.sessionRepo, binding);
		return {
			agents: visibleAgents,
			currentAgentName: currentAgent?.name ?? null
		};
	}
};
//#endregion
//#region src/use-cases/list-lsp.usecase.ts
var ListLspUseCase = class {
	constructor(sessionRepo, opencodeClient) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
	}
	async execute(input) {
		let binding = await this.sessionRepo.getByChatId(input.chatId);
		if (binding?.projectId && binding.directory) {
			if (!hasMatchingProject$2(await this.opencodeClient.listProjects(), binding)) binding = await clearStoredSessionContext(this.sessionRepo, binding);
		}
		const projectContext = binding?.projectId && binding.directory ? {
			projectId: binding.projectId,
			directory: binding.directory
		} : await this.getCurrentProjectContext();
		const statuses = await this.opencodeClient.listLspStatuses(projectContext.directory);
		return {
			currentDirectory: projectContext.directory,
			statuses: [...statuses].sort(compareLspStatuses)
		};
	}
	async getCurrentProjectContext() {
		const currentProject = await this.opencodeClient.getCurrentProject();
		return {
			projectId: currentProject.id,
			directory: currentProject.worktree
		};
	}
};
function compareLspStatuses(left, right) {
	return left.name.localeCompare(right.name) || left.root.localeCompare(right.root) || left.id.localeCompare(right.id);
}
function hasMatchingProject$2(projects, binding) {
	return projects.some((project) => project.id === binding.projectId && project.worktree === binding.directory);
}
//#endregion
//#region src/use-cases/list-mcp.usecase.ts
var ListMcpUseCase = class {
	constructor(sessionRepo, opencodeClient) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
	}
	async execute(input) {
		let binding = await this.sessionRepo.getByChatId(input.chatId);
		if (binding?.projectId && binding.directory) {
			if (!hasMatchingProject$1(await this.opencodeClient.listProjects(), binding)) binding = await clearStoredSessionContext(this.sessionRepo, binding);
		}
		const projectContext = binding?.projectId && binding.directory ? {
			projectId: binding.projectId,
			directory: binding.directory
		} : await this.getCurrentProjectContext();
		const statuses = await this.opencodeClient.listMcpStatuses(projectContext.directory);
		return {
			currentDirectory: projectContext.directory,
			statuses: Object.entries(statuses).sort(([left], [right]) => left.localeCompare(right)).map(([name, status]) => ({
				name,
				status
			}))
		};
	}
	async getCurrentProjectContext() {
		const currentProject = await this.opencodeClient.getCurrentProject();
		return {
			projectId: currentProject.id,
			directory: currentProject.worktree
		};
	}
};
function hasMatchingProject$1(projects, binding) {
	return projects.some((project) => project.id === binding.projectId && project.worktree === binding.directory);
}
//#endregion
//#region src/use-cases/list-models.usecase.ts
var ListModelsUseCase = class {
	constructor(sessionRepo, opencodeClient) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
	}
	async execute(input) {
		let [binding, models] = await Promise.all([this.sessionRepo.getByChatId(input.chatId), this.opencodeClient.listModels()]);
		if (binding?.modelProviderId && binding?.modelId) {
			const selectedModel = models.find((model) => model.providerID === binding?.modelProviderId && model.id === binding?.modelId);
			if (!selectedModel) binding = await clearStoredModelSelection(this.sessionRepo, binding);
			else if (binding.modelVariant && !(binding.modelVariant in selectedModel.variants)) binding = await clearStoredModelVariant(this.sessionRepo, binding);
		}
		return {
			models,
			currentModelProviderId: binding?.modelProviderId ?? null,
			currentModelId: binding?.modelId ?? null,
			currentModelVariant: binding?.modelVariant ?? null
		};
	}
};
//#endregion
//#region src/use-cases/list-sessions.usecase.ts
var ListSessionsUseCase = class {
	constructor(sessionRepo, opencodeClient) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
	}
	async execute(input) {
		let binding = await this.sessionRepo.getByChatId(input.chatId);
		const [sessions, projects] = await Promise.all([this.opencodeClient.listSessions(), binding?.projectId && binding.directory ? this.opencodeClient.listProjects() : Promise.resolve(null)]);
		if (binding?.projectId && binding.directory && !hasMatchingProject(projects, binding)) binding = await clearStoredSessionContext(this.sessionRepo, binding);
		if (binding?.sessionId && binding.projectId && !hasMatchingSession(sessions, binding)) binding = await clearStoredSessionContext(this.sessionRepo, binding);
		const projectContext = binding?.projectId && binding.directory ? {
			projectId: binding.projectId,
			directory: binding.directory
		} : await this.getCurrentProjectContext();
		return {
			sessions: sessions.filter((session) => session.projectID === projectContext.projectId),
			currentProjectId: projectContext.projectId,
			currentDirectory: projectContext.directory,
			currentSessionId: binding?.projectId === projectContext.projectId ? binding.sessionId : null
		};
	}
	async getCurrentProjectContext() {
		const currentProject = await this.opencodeClient.getCurrentProject();
		return {
			projectId: currentProject.id,
			directory: currentProject.worktree
		};
	}
};
function hasMatchingProject(projects, binding) {
	if (!projects) return true;
	return projects.some((project) => project.id === binding.projectId && project.worktree === binding.directory);
}
function hasMatchingSession(sessions, binding) {
	return sessions.some((session) => session.id === binding.sessionId && session.projectID === binding.projectId);
}
//#endregion
//#region src/use-cases/rename-session.usecase.ts
var RenameSessionUseCase = class {
	constructor(sessionRepo, opencodeClient, logger) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async execute(input) {
		const title = input.title.trim();
		if (!title) throw new Error("Session title cannot be empty.");
		const [binding, sessions] = await Promise.all([this.sessionRepo.getByChatId(input.chatId), this.opencodeClient.listSessions()]);
		const currentProjectId = binding?.projectId ?? (await this.opencodeClient.getCurrentProject()).id;
		const session = sessions.find((item) => item.id === input.sessionId && item.projectID === currentProjectId);
		if (!session) return { found: false };
		const renamedSession = await this.opencodeClient.renameSession(session.id, title);
		this.logger.info({
			chatId: input.chatId,
			sessionId: renamedSession.id,
			projectId: renamedSession.projectID,
			title: renamedSession.title
		}, "session renamed");
		return {
			found: true,
			session: renamedSession
		};
	}
};
//#endregion
//#region src/use-cases/prompt-context.ts
var PromptContextResolver = class {
	constructor(sessionRepo, opencodeClient, logger) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async resolve(input) {
		const promptText = buildPromptText(input.text, input.files);
		if (!promptText && input.files.length === 0) throw new Error("Prompt requires text or file attachments.");
		let binding = await this.sessionRepo.getByChatId(input.chatId);
		if (binding?.projectId && binding.directory) {
			if (!(await this.opencodeClient.listProjects()).find((project) => project.id === binding?.projectId && project.worktree === binding.directory)) binding = await this.clearInvalidSessionContext(input.chatId, binding, "saved project is no longer available");
		}
		if (binding?.sessionId && binding.projectId) {
			if (!(await this.opencodeClient.listSessions()).find((session) => session.id === binding?.sessionId && session.projectID === binding.projectId)) binding = await this.clearInvalidSessionContext(input.chatId, binding, "saved session is no longer available");
		}
		if (!binding || !binding.sessionId || !binding.projectId || !binding.directory) {
			const createdSession = await createAndBindCurrentProjectSession(this.sessionRepo, this.opencodeClient, {
				chatId: input.chatId,
				binding
			});
			binding = createdSession.binding;
			logPromptLifecycle(this.logger, {
				chatId: input.chatId,
				event: "prompt.session.created",
				projectId: createdSession.session.projectID,
				sessionId: createdSession.session.id,
				directory: createdSession.session.directory
			}, "session created");
		}
		if (binding?.modelProviderId && binding?.modelId) {
			const selectedModel = (await this.opencodeClient.listModels()).find((model) => model.providerID === binding?.modelProviderId && model.id === binding?.modelId);
			if (!selectedModel) {
				binding = await clearStoredModelSelection(this.sessionRepo, binding);
				this.logger.warn?.({
					chatId: input.chatId,
					event: "prompt.model.unavailable"
				}, "selected model is no longer available, falling back to OpenCode default");
			} else if (binding.modelVariant && !(binding.modelVariant in selectedModel.variants)) {
				binding = await clearStoredModelVariant(this.sessionRepo, binding);
				this.logger.warn?.({
					chatId: input.chatId,
					event: "prompt.model.variant_unavailable",
					providerId: selectedModel.providerID,
					modelId: selectedModel.id
				}, "selected model variant is no longer available, falling back to default variant");
			}
		}
		if (!binding || !binding.sessionId || !binding.projectId || !binding.directory) throw new Error("Failed to initialize chat session.");
		let activeBinding = binding;
		const selectedAgent = resolveSelectedAgent(await this.opencodeClient.listAgents(), activeBinding.agentName);
		if (activeBinding.agentName && selectedAgent?.name !== activeBinding.agentName) {
			activeBinding = await clearStoredAgentSelection(this.sessionRepo, activeBinding);
			this.logger.warn?.({
				chatId: input.chatId,
				event: "prompt.agent.unavailable"
			}, "selected agent is no longer available, falling back to OpenCode default");
		}
		return {
			activeBinding,
			model: activeBinding.modelProviderId && activeBinding.modelId ? {
				providerID: activeBinding.modelProviderId,
				modelID: activeBinding.modelId
			} : null,
			promptText,
			selectedAgent,
			shouldIsolateImageTurn: hasImageFiles(input.files)
		};
	}
	async clearInvalidSessionContext(chatId, binding, reason) {
		const nextBinding = await clearStoredSessionContext(this.sessionRepo, binding);
		this.logger.warn?.({
			chatId,
			event: "prompt.session.invalid_context"
		}, `${reason}, falling back to the current OpenCode project`);
		return nextBinding;
	}
};
function buildPromptText(text, files) {
	const trimmedText = text?.trim() ?? "";
	if (!files.some(isImageFile)) return trimmedText;
	const promptSections = [[
		"System note for this turn:",
		"The user attached one or more images in this message and you can inspect those images directly.",
		"Ignore any earlier statements in this conversation claiming that you could not view images or attachments, because those may have come from a previous model or an earlier limitation.",
		"If an image is blurry or unreadable, say that it is blurry or unreadable instead of saying that you cannot view images."
	].join(" ")];
	if (trimmedText) promptSections.push(trimmedText);
	return promptSections.join("\n\n");
}
function isImageFile(file) {
	return file.mime.trim().toLowerCase().startsWith("image/");
}
function hasImageFiles(files) {
	return files.some(isImageFile);
}
//#endregion
//#region src/use-cases/temporary-image-session-manager.ts
var TemporaryImageSessionManager = class {
	constructor(opencodeClient, logger) {
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async withExecutionSession(input, execute) {
		if (!input.isolate) return execute(input.sessionId);
		const temporarySessionId = await this.createTemporaryImageSession(input.chatId, input.sessionId);
		try {
			return await execute(temporarySessionId);
		} finally {
			await this.cleanupTemporaryImageSession(input.chatId, input.sessionId, temporarySessionId);
		}
	}
	async createTemporaryImageSession(chatId, sessionId) {
		const temporarySession = await this.opencodeClient.forkSession(sessionId);
		if (!temporarySession.id || temporarySession.id === sessionId) throw new Error("OpenCode did not return a distinct temporary session for the image turn.");
		logPromptLifecycle(this.logger, {
			chatId,
			event: "prompt.temporary_session.created",
			parentSessionId: sessionId,
			sessionId: temporarySession.id
		}, "created temporary image session");
		return temporarySession.id;
	}
	async cleanupTemporaryImageSession(chatId, parentSessionId, sessionId) {
		try {
			if (!await this.opencodeClient.deleteSession(sessionId)) this.logger.warn?.({
				chatId,
				event: "prompt.temporary_session.cleanup_failed",
				parentSessionId,
				sessionId
			}, "failed to delete temporary image session");
		} catch (error) {
			this.logger.warn?.({
				error,
				chatId,
				event: "prompt.temporary_session.cleanup_failed",
				parentSessionId,
				sessionId
			}, "failed to delete temporary image session");
		}
	}
};
//#endregion
//#region src/use-cases/send-prompt.usecase.ts
var SendPromptUseCase = class {
	promptContextResolver;
	temporaryImageSessionManager;
	constructor(sessionRepo, opencodeClient, logger, promptContextResolver = new PromptContextResolver(sessionRepo, opencodeClient, logger), temporaryImageSessionManager = new TemporaryImageSessionManager(opencodeClient, logger)) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
		this.promptContextResolver = promptContextResolver;
		this.temporaryImageSessionManager = temporaryImageSessionManager;
	}
	async execute(input) {
		const files = input.files ?? [];
		const context = await this.promptContextResolver.resolve({
			chatId: input.chatId,
			files,
			text: input.text
		});
		const result = await this.temporaryImageSessionManager.withExecutionSession({
			chatId: input.chatId,
			isolate: context.shouldIsolateImageTurn,
			sessionId: context.activeBinding.sessionId
		}, async (executionSessionId) => {
			input.onExecutionSession?.(executionSessionId);
			logOpenCodeRequest(this.logger, {
				chatId: input.chatId,
				event: "opencode.prompt.submit",
				projectId: context.activeBinding.projectId,
				sessionId: executionSessionId,
				fileCount: files.length,
				status: "started"
			}, "submitting OpenCode prompt");
			const assistantReply = await this.opencodeClient.promptSession({
				sessionId: executionSessionId,
				prompt: context.promptText,
				...files.length > 0 ? { files } : {},
				...context.selectedAgent ? { agent: context.selectedAgent.name } : {},
				format: { type: "text" },
				...context.model ? { model: context.model } : {},
				...input.signal ? { signal: input.signal } : {},
				...context.activeBinding.modelVariant ? { variant: context.activeBinding.modelVariant } : {}
			});
			logPromptLifecycle(this.logger, {
				chatId: input.chatId,
				event: "prompt.completed",
				projectId: context.activeBinding.projectId,
				sessionId: executionSessionId,
				status: "completed"
			}, "prompt completed");
			return assistantReply;
		});
		await this.sessionRepo.touch(input.chatId);
		return {
			assistantReply: result,
			sessionId: context.activeBinding.sessionId,
			projectId: context.activeBinding.projectId
		};
	}
};
//#endregion
//#region src/use-cases/switch-agent.usecase.ts
var SwitchAgentUseCase = class {
	constructor(sessionRepo, opencodeClient, logger) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async execute(input) {
		const [binding, agents] = await Promise.all([this.sessionRepo.getByChatId(input.chatId), this.opencodeClient.listAgents()]);
		const agent = agents.find((item) => item.name === input.agentName && isSelectableAgent(item));
		if (!agent) return { found: false };
		await this.sessionRepo.setCurrent({
			chatId: input.chatId,
			sessionId: binding?.sessionId ?? null,
			projectId: binding?.projectId ?? null,
			directory: binding?.directory ?? null,
			agentName: agent.name,
			modelProviderId: binding?.modelProviderId ?? null,
			modelId: binding?.modelId ?? null,
			modelVariant: binding?.modelVariant ?? null,
			language: binding?.language ?? null,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.logger.info({
			chatId: input.chatId,
			agentName: agent.name
		}, "agent switched");
		return {
			found: true,
			agent
		};
	}
};
//#endregion
//#region src/use-cases/switch-model.usecase.ts
var SwitchModelUseCase = class {
	constructor(sessionRepo, opencodeClient, logger) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async execute(input) {
		const [binding, models] = await Promise.all([this.sessionRepo.getByChatId(input.chatId), this.opencodeClient.listModels()]);
		const model = models.find((item) => item.providerID === input.providerId && item.id === input.modelId);
		if (!model) return { found: false };
		const variant = input.variant ?? null;
		if (variant && !(variant in model.variants)) return { found: false };
		await this.sessionRepo.setCurrent({
			chatId: input.chatId,
			sessionId: binding?.sessionId ?? null,
			projectId: binding?.projectId ?? null,
			directory: binding?.directory ?? null,
			agentName: binding?.agentName ?? null,
			modelProviderId: model.providerID,
			modelId: model.id,
			modelVariant: variant,
			language: binding?.language ?? null,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.logger.info({
			chatId: input.chatId,
			providerId: model.providerID,
			modelId: model.id,
			variant
		}, "model switched");
		return {
			found: true,
			model,
			variant
		};
	}
};
//#endregion
//#region src/use-cases/switch-session.usecase.ts
var SwitchSessionUseCase = class {
	constructor(sessionRepo, opencodeClient, logger) {
		this.sessionRepo = sessionRepo;
		this.opencodeClient = opencodeClient;
		this.logger = logger;
	}
	async execute(input) {
		const [binding, sessions] = await Promise.all([this.sessionRepo.getByChatId(input.chatId), this.opencodeClient.listSessions()]);
		const currentProjectId = binding?.projectId ?? (await this.opencodeClient.getCurrentProject()).id;
		const session = sessions.find((item) => item.id === input.sessionId && item.projectID === currentProjectId);
		if (!session) return { found: false };
		await this.sessionRepo.setCurrent({
			chatId: input.chatId,
			sessionId: session.id,
			projectId: session.projectID,
			directory: session.directory,
			agentName: binding?.agentName ?? null,
			modelProviderId: binding?.modelProviderId ?? null,
			modelId: binding?.modelId ?? null,
			modelVariant: binding?.modelVariant ?? null,
			language: binding?.language ?? null,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.logger.info({
			chatId: input.chatId,
			sessionId: session.id,
			projectId: session.projectID,
			directory: session.directory
		}, "session switched");
		return {
			found: true,
			session
		};
	}
};
//#endregion
//#region src/use-cases/toggle-token-setting.usecase.ts
var ToggleTokenSettingUseCase = class {
	constructor(tokenSettingsRepo) {
		this.tokenSettingsRepo = tokenSettingsRepo;
	}
	async execute(input) {
		const current = await this.tokenSettingsRepo.get();
		const normalizedShowBreakdown = input.showBreakdown === true;
		if (current.showBreakdown === normalizedShowBreakdown) return {
			updated: false,
			showBreakdown: current.showBreakdown
		};
		await this.tokenSettingsRepo.set({ showBreakdown: normalizedShowBreakdown });
		return {
			updated: true,
			showBreakdown: normalizedShowBreakdown
		};
	}
};
//#endregion
//#region src/use-cases/upload-file.usecase.ts
var ImageFileDownloadError = class extends Error {
	data;
	constructor(message) {
		super(message);
		this.name = "ImageFileDownloadError";
		this.data = { message };
	}
};
var ImageMessageUnsupportedError = class extends Error {
	data;
	constructor(message) {
		super(message);
		this.name = "ImageMessageUnsupportedError";
		this.data = { message };
	}
};
var UploadFileUseCase = class {
	constructor(telegramFileClient) {
		this.telegramFileClient = telegramFileClient;
	}
	async execute(input) {
		if (input.expectedType !== "image") throw new ImageMessageUnsupportedError("Only image uploads are supported.");
		let download;
		try {
			download = await this.telegramFileClient.downloadFile({ filePath: input.filePath });
		} catch (error) {
			if (error instanceof TelegramFileDownloadError) throw new ImageFileDownloadError(error.message);
			throw error;
		}
		const mimeType = normalizeMimeType(input.mimeType ?? download.mimeType);
		if (!mimeType.startsWith("image/")) throw new ImageMessageUnsupportedError(`Unsupported image MIME type: ${mimeType}`);
		return {
			filename: resolveFilename(input.filename, input.filePath, mimeType),
			mime: mimeType,
			url: buildDataUrl(download.data, mimeType)
		};
	}
};
function buildDataUrl(data, mimeType) {
	return `data:${mimeType};base64,${Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64")}`;
}
function normalizeMimeType(value) {
	const normalized = value?.trim().toLowerCase();
	return normalized && normalized.length > 0 ? normalized : "application/octet-stream";
}
function resolveFilename(explicitFilename, filePath, mimeType) {
	const preferredFilename = explicitFilename?.trim();
	if (preferredFilename) return preferredFilename;
	const filePathFilename = filePath.split("/").at(-1)?.trim();
	if (filePathFilename) return filePathFilename;
	return `telegram-upload${resolveExtension(mimeType)}`;
}
function resolveExtension(mimeType) {
	switch (mimeType) {
		case "image/jpeg": return ".jpg";
		case "image/png": return ".png";
		case "image/webp": return ".webp";
		case "image/gif": return ".gif";
		default: return "";
	}
}
//#endregion
//#region src/app/container.ts
function createAppContainer(config, client) {
	const runtimeId = randomUUID();
	const logger = createOpenCodeAppLogger(client, {
		file: {
			dir: config.loggingFileDir,
			retention: {
				maxFiles: config.loggingRetentionMaxFiles,
				maxTotalBytes: config.loggingRetentionMaxTotalBytes
			}
		},
		level: config.loggingLevel,
		runtimeId,
		sinks: {
			file: config.loggingFileSinkEnabled,
			host: config.loggingHostSinkEnabled
		},
		worktree: config.worktreePath
	});
	return createContainer(config, createOpenCodeClientFromSdkClient(client, {
		waitTimeoutMs: config.promptWaitTimeoutMs,
		pollRequestTimeoutMs: config.promptPollRequestTimeoutMs,
		recoveryInactivityTimeoutMs: config.promptRecoveryInactivityTimeoutMs
	}), logger);
}
function createContainer(config, opencodeClient, logger) {
	const storageLogger = logger.child({ component: "storage" });
	const repositories = createContainerRepositories(config);
	const runtimeServices = createContainerRuntimeServices(config);
	const useCases = createContainerUseCases({
		...repositories,
		...runtimeServices,
		logger,
		opencodeClient
	});
	let disposed = false;
	return {
		...useCases,
		logger,
		...repositories,
		...runtimeServices,
		opencodeClient,
		async dispose() {
			if (disposed) return;
			disposed = true;
			storageLogger.info({
				event: "storage.container.disposed",
				filePath: config.stateFilePath
			}, "disposing telegram bot container");
			await logger.flush();
		}
	};
}
function createContainerRepositories(config) {
	const stateStore = new JsonStateStore({
		filePath: config.stateFilePath,
		createDefaultState: createDefaultOpencodeTbotState
	});
	return {
		pendingActionRepo: new FilePendingActionRepository(stateStore),
		permissionApprovalRepo: new FilePermissionApprovalRepository(stateStore),
		sessionRepo: new FileSessionRepository(stateStore),
		tokenSettingsRepo: new FileTokenSettingsRepository(config.pluginConfigFilePath, { showBreakdown: config.tokenShowBreakdown })
	};
}
function createContainerRuntimeServices(config) {
	const telegramFileClient = new TelegramFileClient({
		botToken: config.telegramBotToken,
		apiRoot: config.telegramApiRoot
	});
	return {
		foregroundSessionTracker: new ForegroundSessionTracker(),
		uploadFileUseCase: new UploadFileUseCase(telegramFileClient)
	};
}
function createContainerUseCases(input) {
	const opencodeLogger = input.logger.child({ component: "opencode" });
	const promptLogger = input.logger.child({ component: "prompt" });
	const abortPromptUseCase = new AbortPromptUseCase(input.sessionRepo, input.opencodeClient, input.foregroundSessionTracker);
	const createSessionUseCase = new CreateSessionUseCase(input.sessionRepo, input.opencodeClient, opencodeLogger);
	const getHealthUseCase = new GetHealthUseCase(input.opencodeClient);
	const getPathUseCase = new GetPathUseCase(input.opencodeClient);
	const getTokenSettingsUseCase = new GetTokenSettingsUseCase(input.tokenSettingsRepo);
	const listAgentsUseCase = new ListAgentsUseCase(input.sessionRepo, input.opencodeClient);
	const listLspUseCase = new ListLspUseCase(input.sessionRepo, input.opencodeClient);
	const listMcpUseCase = new ListMcpUseCase(input.sessionRepo, input.opencodeClient);
	const listSessionsUseCase = new ListSessionsUseCase(input.sessionRepo, input.opencodeClient);
	return {
		abortPromptUseCase,
		createSessionUseCase,
		getHealthUseCase,
		getPathUseCase,
		getStatusUseCase: new GetStatusUseCase(createStatusSectionProviders({
			configuredPluginReader: input.opencodeClient,
			getHealthUseCase,
			getPathUseCase,
			listLspUseCase,
			listMcpUseCase,
			listSessionsUseCase,
			sessionRepo: input.sessionRepo
		})),
		getTokenSettingsUseCase,
		listAgentsUseCase,
		listLspUseCase,
		listMcpUseCase,
		listModelsUseCase: new ListModelsUseCase(input.sessionRepo, input.opencodeClient),
		listSessionsUseCase,
		renameSessionUseCase: new RenameSessionUseCase(input.sessionRepo, input.opencodeClient, opencodeLogger),
		sendPromptUseCase: new SendPromptUseCase(input.sessionRepo, input.opencodeClient, promptLogger),
		switchAgentUseCase: new SwitchAgentUseCase(input.sessionRepo, input.opencodeClient, opencodeLogger),
		switchModelUseCase: new SwitchModelUseCase(input.sessionRepo, input.opencodeClient, opencodeLogger),
		switchSessionUseCase: new SwitchSessionUseCase(input.sessionRepo, input.opencodeClient, opencodeLogger),
		toggleTokenSettingUseCase: new ToggleTokenSettingUseCase(input.tokenSettingsRepo)
	};
}
//#endregion
//#region src/app/bootstrap.ts
function bootstrapPluginApp(client, configSource = {}, options = {}) {
	const config = loadAppConfig(configSource, options);
	return {
		config,
		container: createAppContainer(config, client)
	};
}
var SUPPORTED_BOT_LANGUAGES = [
	"en",
	"zh-CN",
	"ja"
];
var EN_BOT_COPY = {
	locale: "en",
	commands: {
		start: "Show welcome and quick start",
		status: "Show system status",
		new: "Create a new session",
		agents: "Show and switch agents",
		sessions: "Show and switch sessions",
		cancel: "Cancel rename or abort running request",
		model: "Show and switch models",
		token: "Show or hide token breakdown details",
		language: "Show and switch language"
	},
	start: { lines: [
		"# Welcome to opencode-tbot",
		"",
		"Talk to your OpenCode server from Telegram.",
		"",
		"## Quick start",
		"1. Run `/status` to confirm the server is ready.",
		"2. Run `/new [title]` to create a fresh session.",
		"",
		"Send a text or image message directly."
	] },
	systemStatus: { title: "System Status" },
	common: {
		notSelected: "Not selected",
		openCodeDefault: "Not selected (using OpenCode default)",
		previousPage: "Previous",
		nextPage: "Next",
		page(currentPage, totalPages) {
			return `Page ${currentPage}/${totalPages}`;
		}
	},
	status: {
		processing: "Processing...",
		alreadyProcessing: "Another request is still running. Wait for it to finish before sending a new prompt."
	},
	auth: { unauthorizedChat: "Unauthorized chat." },
	prompt: { emptyResponse: "OpenCode returned empty response." },
	replyMetrics: {
		durationLabel: "Duration",
		tokensLabel: "Displayed Tokens",
		totalLabel: "total",
		inputLabel: "request input",
		outputLabel: "output",
		reasoningLabel: "reasoning",
		cacheReadLabel: "cache.read",
		cacheWriteLabel: "cache.write",
		notAvailable: "n/a"
	},
	abort: {
		noSession: "No active session is bound to this chat yet.",
		notRunning: "No request is currently running for the current session.",
		aborted: "Abort signal sent to the current session."
	},
	permission: {
		requestTitle: "Permission Request",
		permissionLabel: "Permission",
		sessionLabel: "Session",
		patternsLabel: "Patterns",
		noPatterns: "(none)",
		allowOnce: "Allow once",
		allowAlways: "Always allow",
		reject: "Reject",
		replyFailed: "Failed to reply to the permission request.",
		replyLabels: {
			once: "allow once",
			always: "always allow",
			reject: "reject"
		},
		resolved(requestId, replyLabel) {
			return [
				"Permission request resolved.",
				"",
				`Request: ${requestId}`,
				`Reply: ${replyLabel}`
			].join("\n");
		}
	},
	sessionEvents: {
		unknownError: "Unknown session error.",
		failed(sessionId, error) {
			return [
				"Session failed.",
				"",
				`Session: ${sessionId}`,
				`Error: ${error}`
			].join("\n");
		}
	},
	errors: {
		unexpected: "Unexpected error.",
		providerAuth: "Provider authentication failed.",
		requestAborted: "Request was aborted.",
		promptTimeout: "OpenCode request timed out.",
		structuredOutput: "Structured output validation failed.",
		voiceUnsupported: "Voice messages are not supported. Send text or an image instead.",
		imageDownload: "Failed to download the Telegram image file.",
		imageUnsupported: "Image file is too large or unsupported.",
		outputLength: "Reply hit the model output limit.",
		contextOverflow: "Conversation exceeded the model context window.",
		providerRequest: "Provider request failed.",
		notFound: "Requested resource was not found.",
		badRequest: "Request was rejected by OpenCode.",
		causeLabel: "Cause",
		retryableLabel: "retryable",
		statusCodeLabel: "status"
	},
	health: {
		title: "Server Health",
		status(healthy) {
			return `Status: ${healthy ? "healthy" : "unhealthy"}`;
		},
		version(version) {
			return `Version: ${version}`;
		}
	},
	path: {
		title: "Current Paths",
		home(path) {
			return `Home: ${path}`;
		},
		state(path) {
			return `State: ${path}`;
		},
		config(path) {
			return `Config: ${path}`;
		},
		worktree(path) {
			return `Worktree: ${path}`;
		},
		directory(path) {
			return `Current working directory: ${path}`;
		}
	},
	sessions: {
		none: "No sessions available in the current project.",
		title: "Session List",
		actionTitle: "Session Actions",
		chooseAction: "Choose an action for this session.",
		currentProject(worktree) {
			return `Current project: ${worktree}`;
		},
		currentSession(session) {
			return `Current session: ${session}`;
		},
		selectedSession(session) {
			return `Selected session: ${session}`;
		},
		switched: "Session switched.",
		created: "Session created.",
		renamed: "Session renamed.",
		renameCancelled: "Session rename cancelled.",
		renameEmpty: "Session name cannot be empty. Send a new name or /cancel.",
		renameExpired: "The session is no longer available. Run /sessions again.",
		renamePendingInput: "Waiting for the new session name. Send plain text or /cancel.",
		renamePrompt(session) {
			return [
				`Rename session: ${session}`,
				"Send the new session name as your next text message.",
				"Send /cancel to cancel."
			].join("\n");
		},
		switchAction: "Switch",
		renameAction: "Rename",
		backToList: "Back to list",
		expired: "The session is no longer available. Run /sessions again."
	},
	lsp: {
		none: "No LSP servers detected for the current project.",
		title: "LSP Servers",
		currentProject(worktree) {
			return `Current project: ${worktree}`;
		},
		connected: "connected",
		error: "error"
	},
	mcp: {
		none: "No MCP servers configured for the current project.",
		title: "MCP Servers",
		currentProject(worktree) {
			return `Current project: ${worktree}`;
		},
		connected: "connected",
		disabled: "disabled",
		needsAuth: "needs auth",
		failed(error) {
			return `failed: ${error}`;
		},
		needsClientRegistration(error) {
			return `needs client registration: ${error}`;
		}
	},
	agents: {
		none: "No agents available.",
		title: "Agent List",
		current(agent) {
			return `Current agent: ${agent}`;
		},
		switched: "Agent switched.",
		expired: "The agent is no longer available. Run /agents again."
	},
	models: {
		none: "No models available.",
		title: "Model List",
		configuredOnly: "Only models exposed by OpenCode for connected providers are shown.",
		current(model) {
			return `Current model: ${model}`;
		},
		switched: "Model switched.",
		currentReasoningLevel(variant) {
			return `Current reasoning level: ${variant}`;
		},
		reasoningLevel(variant) {
			return `Reasoning level: ${variant}`;
		},
		noReasoningLevels: "This model has no selectable reasoning levels.",
		reasoningLevelsTitle: "Reasoning Levels",
		model(model) {
			return `Model: ${model}`;
		},
		modelNumber(modelIndex) {
			return `Model number: ${modelIndex}`;
		},
		expired: "The model is no longer available. Run /model again.",
		reasoningLevelExpired: "The reasoning level is no longer available. Run /model again.",
		defaultReasoningLevel: "default"
	},
	token: {
		title: "Token Breakdown",
		description: "Control whether replies show a second footer line with the full token breakdown.",
		scopeNotice: "This is a global plugin setting and affects future reply footers shown in every chat.",
		currentStatus(status) {
			return `Current status: ${status}`;
		},
		footerSummary: "Replies always show Duration | Displayed Tokens.",
		footerBreakdown: "When enabled, a second line shows request input, output, reasoning, cache.read, and cache.write.",
		enabledLabel: "Enabled",
		disabledLabel: "Disabled"
	},
	language: {
		title: "Language",
		choose: "Choose the display language for bot menus and replies.",
		current(label) {
			return `Current language: ${label}`;
		},
		switched: "Language switched.",
		expired: "The language option is no longer available. Run /language again.",
		labels: {
			en: "English",
			"zh-CN": "简体中文",
			ja: "日本語"
		}
	}
};
var ZH_CN_BOT_COPY = {
	locale: "zh-CN",
	commands: {
		start: "查看欢迎信息与快速开始",
		status: "查看系统状态",
		new: "新建会话",
		agents: "查看并切换 Agent",
		sessions: "查看并切换会话",
		cancel: "取消重命名或中止当前请求",
		model: "查看并切换模型",
		token: "开启/关闭令牌明细显示",
		language: "查看并切换语言"
	},
	start: { lines: [
		"# 欢迎使用 opencode-tbot",
		"",
		"通过 Telegram 直接和 OpenCode 服务对话。",
		"",
		"## 快速开始",
		"1. 先运行 `/status` 确认服务状态正常。",
		"2. 运行 `/new [title]` 创建一个新会话。",
		"",
		"直接发送文本或图片消息即可。"
	] },
	systemStatus: { title: "系统状态" },
	common: {
		notSelected: "未选择",
		openCodeDefault: "未选择（使用 OpenCode 默认值）",
		previousPage: "上一页",
		nextPage: "下一页",
		page(currentPage, totalPages) {
			return `第 ${currentPage}/${totalPages} 页`;
		}
	},
	status: {
		processing: "处理中...",
		alreadyProcessing: "另一个请求仍在运行。请等待其完成后再发送新的提示词。"
	},
	auth: { unauthorizedChat: "当前聊天未获授权。" },
	prompt: { emptyResponse: "OpenCode 返回了空响应。" },
	replyMetrics: {
		durationLabel: "耗时",
		tokensLabel: "显示令牌数",
		totalLabel: "总计",
		inputLabel: "本次请求总输入",
		outputLabel: "输出",
		reasoningLabel: "推理",
		cacheReadLabel: "缓存读取",
		cacheWriteLabel: "缓存写入",
		notAvailable: "不可用"
	},
	abort: {
		noSession: "当前聊天还没有绑定活动会话。",
		notRunning: "当前会话没有正在运行的请求。",
		aborted: "已向当前会话发送中止信号。"
	},
	permission: {
		requestTitle: "权限请求",
		permissionLabel: "权限",
		sessionLabel: "会话",
		patternsLabel: "匹配范围",
		noPatterns: "（无）",
		allowOnce: "本次允许",
		allowAlways: "始终允许",
		reject: "拒绝",
		replyFailed: "回复权限请求失败。",
		replyLabels: {
			once: "本次允许",
			always: "始终允许",
			reject: "拒绝"
		},
		resolved(requestId, replyLabel) {
			return [
				"权限请求已处理。",
				"",
				`请求：${requestId}`,
				`结果：${replyLabel}`
			].join("\n");
		}
	},
	sessionEvents: {
		unknownError: "未知会话错误。",
		failed(sessionId, error) {
			return [
				"会话执行失败。",
				"",
				`会话：${sessionId}`,
				`错误：${error}`
			].join("\n");
		}
	},
	errors: {
		unexpected: "发生未知错误。",
		providerAuth: "Provider 认证失败。",
		requestAborted: "请求已中止。",
		promptTimeout: "OpenCode 响应超时。",
		structuredOutput: "结构化输出校验失败。",
		voiceUnsupported: "暂不支持语音消息，请改发文本或图片。",
		imageDownload: "下载 Telegram 图片文件失败。",
		imageUnsupported: "图片文件过大或不受支持。",
		outputLength: "回复触发了模型输出长度上限。",
		contextOverflow: "会话已超过模型上下文窗口。",
		providerRequest: "Provider 请求失败。",
		notFound: "请求的资源不存在。",
		badRequest: "OpenCode 拒绝了该请求。",
		causeLabel: "原因",
		retryableLabel: "可重试",
		statusCodeLabel: "状态码"
	},
	health: {
		title: "服务健康状态",
		status(healthy) {
			return `状态: ${healthy ? "健康" : "异常"}`;
		},
		version(version) {
			return `版本: ${version}`;
		}
	},
	path: {
		title: "当前路径",
		home(path) {
			return `主目录: ${path}`;
		},
		state(path) {
			return `状态目录: ${path}`;
		},
		config(path) {
			return `配置文件: ${path}`;
		},
		worktree(path) {
			return `工作树: ${path}`;
		},
		directory(path) {
			return `当前工作目录: ${path}`;
		}
	},
	sessions: {
		none: "当前项目下没有可用会话。",
		title: "会话列表",
		actionTitle: "会话操作",
		chooseAction: "请选择该会话的操作。",
		currentProject(worktree) {
			return `当前项目: ${worktree}`;
		},
		currentSession(session) {
			return `当前会话: ${session}`;
		},
		selectedSession(session) {
			return `已选会话: ${session}`;
		},
		switched: "会话已切换。",
		created: "会话已创建。",
		renamed: "会话已重命名。",
		renameCancelled: "已取消会话重命名。",
		renameEmpty: "会话名称不能为空。请重新发送名称或发送 /cancel。",
		renameExpired: "该会话已不可用。请重新运行 /sessions。",
		renamePendingInput: "当前正在等待新的会话名称。请发送纯文本或 /cancel。",
		renamePrompt(session) {
			return [
				`重命名会话: ${session}`,
				"请发送新的会话名称。",
				"发送 /cancel 取消。"
			].join("\n");
		},
		switchAction: "切换",
		renameAction: "重命名",
		backToList: "返回列表",
		expired: "该会话已不可用。请重新运行 /sessions。"
	},
	lsp: {
		none: "当前项目未检测到 LSP。",
		title: "LSP 服务",
		currentProject(worktree) {
			return `当前项目: ${worktree}`;
		},
		connected: "已连接",
		error: "异常"
	},
	mcp: {
		none: "当前项目未配置 MCP。",
		title: "MCP 服务",
		currentProject(worktree) {
			return `当前项目: ${worktree}`;
		},
		connected: "已连接",
		disabled: "已禁用",
		needsAuth: "需要认证",
		failed(error) {
			return `失败: ${error}`;
		},
		needsClientRegistration(error) {
			return `需要客户端注册: ${error}`;
		}
	},
	agents: {
		none: "没有可用 Agent。",
		title: "Agent 列表",
		current(agent) {
			return `当前 Agent: ${agent}`;
		},
		switched: "Agent 已切换。",
		expired: "该 Agent 已不可用。请重新运行 /agents。"
	},
	models: {
		none: "没有可用模型。",
		title: "模型列表",
		configuredOnly: "仅显示 OpenCode 为已连接 provider 暴露的模型。",
		current(model) {
			return `当前模型: ${model}`;
		},
		switched: "模型已切换。",
		currentReasoningLevel(variant) {
			return `当前推理级别: ${variant}`;
		},
		reasoningLevel(variant) {
			return `推理级别: ${variant}`;
		},
		noReasoningLevels: "该模型没有可选的推理级别。",
		reasoningLevelsTitle: "推理级别",
		model(model) {
			return `模型: ${model}`;
		},
		modelNumber(modelIndex) {
			return `模型编号: ${modelIndex}`;
		},
		expired: "该模型已不可用。请重新运行 /model。",
		reasoningLevelExpired: "该推理级别已不可用。请重新运行 /model。",
		defaultReasoningLevel: "默认"
	},
	token: {
		title: "令牌明细显示",
		description: "控制是否在回复页脚第二行显示完整 token 明细。",
		scopeNotice: "这是全局插件设置，会影响所有聊天后续回复页脚的 token 显示。",
		currentStatus(status) {
			return `\u5f53\u524d\u72b6\u6001: ${status}`;
		},
		footerSummary: "回复会始终显示：耗时 | 显示令牌数。",
		footerBreakdown: "开启后，第二行会显示本次请求总输入、输出、推理、缓存读取和缓存写入。",
		enabledLabel: "已开启",
		disabledLabel: "已关闭"
	},
	language: {
		title: "语言",
		choose: "选择 Bot 菜单和回复的显示语言。",
		current(label) {
			return `当前语言: ${label}`;
		},
		switched: "语言已切换。",
		expired: "该语言选项已不可用。请重新运行 /language。",
		labels: {
			en: "English",
			"zh-CN": "简体中文",
			ja: "日本語"
		}
	}
};
var JA_BOT_COPY = {
	locale: "ja",
	commands: {
		start: "ようこそとクイックスタートを表示",
		status: "システム状態を表示",
		new: "新しいセッションを作成",
		agents: "エージェントを表示して切り替え",
		sessions: "セッションを表示して切り替え",
		cancel: "名前変更を取り消すか実行中のリクエストを中止",
		model: "モデルを表示して切り替え",
		token: "トークン明細の表示を切り替え",
		language: "言語を表示して切り替え"
	},
	start: { lines: [
		"# opencode-tbot へようこそ",
		"",
		"Telegram から OpenCode サーバーとやり取りできます。",
		"",
		"## クイックスタート",
		"1. `/status` を実行してサーバーの準備完了を確認します。",
		"2. `/new [title]` を実行して新しいセッションを作成します。",
		"",
		"そのままテキストまたは画像メッセージを送信できます。"
	] },
	systemStatus: { title: "システム状態" },
	common: {
		notSelected: "未選択",
		openCodeDefault: "未選択（OpenCode のデフォルトを使用）",
		previousPage: "前へ",
		nextPage: "次へ",
		page(currentPage, totalPages) {
			return `ページ ${currentPage}/${totalPages}`;
		}
	},
	status: {
		processing: "処理中...",
		alreadyProcessing: "別のリクエストがまだ実行中です。完了するまで新しいプロンプトを送信しないでください。"
	},
	auth: { unauthorizedChat: "このチャットにはアクセス権がありません。" },
	prompt: { emptyResponse: "OpenCode から空の応答が返されました。" },
	replyMetrics: {
		durationLabel: "所要時間",
		tokensLabel: "表示トークン数",
		totalLabel: "合計",
		inputLabel: "今回のリクエスト総入力",
		outputLabel: "出力",
		reasoningLabel: "推論",
		cacheReadLabel: "キャッシュ読込",
		cacheWriteLabel: "キャッシュ書込",
		notAvailable: "該当なし"
	},
	abort: {
		noSession: "このチャットにはまだアクティブなセッションが紐付いていません。",
		notRunning: "現在のセッションで実行中のリクエストはありません。",
		aborted: "現在のセッションに中止シグナルを送信しました。"
	},
	permission: {
		requestTitle: "権限リクエスト",
		permissionLabel: "権限",
		sessionLabel: "セッション",
		patternsLabel: "対象パターン",
		noPatterns: "（なし）",
		allowOnce: "今回のみ許可",
		allowAlways: "常に許可",
		reject: "拒否",
		replyFailed: "権限リクエストへの応答に失敗しました。",
		replyLabels: {
			once: "今回のみ許可",
			always: "常に許可",
			reject: "拒否"
		},
		resolved(requestId, replyLabel) {
			return [
				"権限リクエストを処理しました。",
				"",
				`リクエスト: ${requestId}`,
				`結果: ${replyLabel}`
			].join("\n");
		}
	},
	sessionEvents: {
		unknownError: "不明なセッションエラーです。",
		failed(sessionId, error) {
			return [
				"セッションの実行に失敗しました。",
				"",
				`セッション: ${sessionId}`,
				`エラー: ${error}`
			].join("\n");
		}
	},
	errors: {
		unexpected: "予期しないエラーが発生しました。",
		providerAuth: "Provider の認証に失敗しました。",
		requestAborted: "リクエストは中止されました。",
		promptTimeout: "OpenCode リクエストがタイムアウトしました。",
		structuredOutput: "構造化出力の検証に失敗しました。",
		voiceUnsupported: "音声メッセージには対応していません。代わりにテキストまたは画像を送信してください。",
		imageDownload: "Telegram の画像ファイルをダウンロードできませんでした。",
		imageUnsupported: "画像ファイルが大きすぎるか、サポートされていません。",
		outputLength: "返信がモデルの出力上限に達しました。",
		contextOverflow: "会話がモデルのコンテキスト上限を超えました。",
		providerRequest: "Provider へのリクエストに失敗しました。",
		notFound: "要求されたリソースが見つかりませんでした。",
		badRequest: "リクエストは OpenCode に拒否されました。",
		causeLabel: "原因",
		retryableLabel: "再試行可能",
		statusCodeLabel: "ステータス"
	},
	health: {
		title: "サーバー状態",
		status(healthy) {
			return `状態: ${healthy ? "正常" : "異常"}`;
		},
		version(version) {
			return `バージョン: ${version}`;
		}
	},
	path: {
		title: "現在のパス",
		home(path) {
			return `ホーム: ${path}`;
		},
		state(path) {
			return `状態: ${path}`;
		},
		config(path) {
			return `設定: ${path}`;
		},
		worktree(path) {
			return `ワークツリー: ${path}`;
		},
		directory(path) {
			return `現在の作業ディレクトリ: ${path}`;
		}
	},
	sessions: {
		none: "現在のプロジェクトで利用できるセッションはありません。",
		title: "セッション一覧",
		actionTitle: "セッション操作",
		chooseAction: "このセッションに対する操作を選択してください。",
		currentProject(worktree) {
			return `現在のプロジェクト: ${worktree}`;
		},
		currentSession(session) {
			return `現在のセッション: ${session}`;
		},
		selectedSession(session) {
			return `選択中のセッション: ${session}`;
		},
		switched: "セッションを切り替えました。",
		created: "セッションを作成しました。",
		renamed: "セッション名を変更しました。",
		renameCancelled: "セッション名の変更を取り消しました。",
		renameEmpty: "セッション名は空にできません。新しい名前を送信するか /cancel を実行してください。",
		renameExpired: "このセッションはもう利用できません。/sessions を再実行してください。",
		renamePendingInput: "新しいセッション名の入力待ちです。プレーンテキストを送るか /cancel を実行してください。",
		renamePrompt(session) {
			return [
				`セッション名を変更: ${session}`,
				"次のテキストメッセージで新しいセッション名を送信してください。",
				"/cancel で取り消します。"
			].join("\n");
		},
		switchAction: "切り替え",
		renameAction: "名前変更",
		backToList: "一覧に戻る",
		expired: "このセッションはもう利用できません。/sessions を再実行してください。"
	},
	lsp: {
		none: "現在のプロジェクトで LSP サーバーは検出されませんでした。",
		title: "LSP サーバー",
		currentProject(worktree) {
			return `現在のプロジェクト: ${worktree}`;
		},
		connected: "接続済み",
		error: "エラー"
	},
	mcp: {
		none: "現在のプロジェクトで MCP サーバーは設定されていません。",
		title: "MCP サーバー",
		currentProject(worktree) {
			return `現在のプロジェクト: ${worktree}`;
		},
		connected: "接続済み",
		disabled: "無効",
		needsAuth: "認証が必要",
		failed(error) {
			return `失敗: ${error}`;
		},
		needsClientRegistration(error) {
			return `クライアント登録が必要: ${error}`;
		}
	},
	agents: {
		none: "利用可能なエージェントはありません。",
		title: "エージェント一覧",
		current(agent) {
			return `現在のエージェント: ${agent}`;
		},
		switched: "エージェントを切り替えました。",
		expired: "このエージェントはもう利用できません。/agents を再実行してください。"
	},
	models: {
		none: "利用可能なモデルはありません。",
		title: "モデル一覧",
		configuredOnly: "OpenCode が接続済み provider 向けに公開しているモデルのみ表示します。",
		current(model) {
			return `現在のモデル: ${model}`;
		},
		switched: "モデルを切り替えました。",
		currentReasoningLevel(variant) {
			return `現在の推論レベル: ${variant}`;
		},
		reasoningLevel(variant) {
			return `推論レベル: ${variant}`;
		},
		noReasoningLevels: "このモデルには選択可能な推論レベルがありません。",
		reasoningLevelsTitle: "推論レベル",
		model(model) {
			return `モデル: ${model}`;
		},
		modelNumber(modelIndex) {
			return `モデル番号: ${modelIndex}`;
		},
		expired: "このモデルはもう利用できません。/model を再実行してください。",
		reasoningLevelExpired: "この推論レベルはもう利用できません。/model を再実行してください。",
		defaultReasoningLevel: "デフォルト"
	},
	token: {
		title: "トークン明細表示",
		description: "返信フッターの2行目に完全な token 明細を表示するかを制御します。",
		scopeNotice: "これはプラグイン全体の設定で、すべての chat の以後の返信フッターの token 表示に適用されます。",
		currentStatus(status) {
			return `\u73fe\u5728\u306e\u72b6\u614b: ${status}`;
		},
		footerSummary: "返信は常に「所要時間 | 表示トークン数」を表示します。",
		footerBreakdown: "有効にすると2行目に今回のリクエスト総入力、出力、推論、cache.read、cache.write を表示します。",
		enabledLabel: "有効",
		disabledLabel: "無効"
	},
	language: {
		title: "言語",
		choose: "Bot のメニューと返信に使う表示言語を選択してください。",
		current(label) {
			return `現在の言語: ${label}`;
		},
		switched: "言語を切り替えました。",
		expired: "この言語オプションはもう利用できません。/language を再実行してください。",
		labels: {
			en: "English",
			"zh-CN": "简体中文",
			ja: "日本語"
		}
	}
};
var BOT_COPY = EN_BOT_COPY;
function isBotLanguage(value) {
	return SUPPORTED_BOT_LANGUAGES.includes(value);
}
function normalizeBotLanguage(value) {
	if (!value) return "en";
	const normalized = value.trim().toLowerCase();
	if (normalized === "zh-cn" || normalized === "zh-hans" || normalized === "zh") return "zh-CN";
	if (normalized === "ja" || normalized === "ja-jp" || normalized === "ja_jp") return "ja";
	return "en";
}
function getBotCopy(language = "en") {
	const normalized = normalizeBotLanguage(language);
	if (normalized === "zh-CN") return ZH_CN_BOT_COPY;
	if (normalized === "ja") return JA_BOT_COPY;
	return EN_BOT_COPY;
}
function getLanguageLabel(language, copy = BOT_COPY) {
	return copy.language.labels[language];
}
//#endregion
//#region src/bot/i18n.ts
async function getChatLanguage(sessionRepo, chatId) {
	if (!chatId) return "en";
	return normalizeBotLanguage((await sessionRepo.getByChatId(chatId))?.language);
}
async function getSafeChatLanguage(sessionRepo, chatId, logger) {
	try {
		return await getChatLanguage(sessionRepo, chatId);
	} catch (error) {
		logger?.warn?.({
			error,
			chatId: chatId ?? void 0
		}, "failed to resolve Telegram chat language; falling back to the default locale");
		return "en";
	}
}
async function getSafeChatCopy(sessionRepo, chatId, logger) {
	try {
		return getBotCopy(await getSafeChatLanguage(sessionRepo, chatId, logger));
	} catch (error) {
		logger?.warn?.({
			error,
			chatId: chatId ?? void 0
		}, "failed to resolve Telegram copy; falling back to the default locale");
		return BOT_COPY;
	}
}
async function setChatLanguage(sessionRepo, chatId, language) {
	const binding = await sessionRepo.getByChatId(chatId);
	await sessionRepo.setCurrent({
		chatId,
		sessionId: binding?.sessionId ?? null,
		projectId: binding?.projectId ?? null,
		directory: binding?.directory ?? null,
		agentName: binding?.agentName ?? null,
		modelProviderId: binding?.modelProviderId ?? null,
		modelId: binding?.modelId ?? null,
		modelVariant: binding?.modelVariant ?? null,
		language,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	});
}
//#endregion
//#region src/services/permission/telegram-approval.ts
function buildPermissionApprovalMessage(request, copy = BOT_COPY) {
	const patternLines = request.patterns.length > 0 ? request.patterns : [copy.permission.noPatterns];
	const plainText = [
		copy.permission.requestTitle,
		"",
		`${copy.permission.permissionLabel}: ${request.permission}`,
		`${copy.permission.sessionLabel}: ${request.sessionID}`,
		"",
		`${copy.permission.patternsLabel}:`,
		...patternLines.map((pattern) => `- ${pattern}`)
	].join("\n");
	return {
		preferred: {
			text: [
				`*${escapeMarkdownV2(copy.permission.requestTitle)}*`,
				"",
				`${escapeMarkdownV2(copy.permission.permissionLabel)}: ${escapeMarkdownV2(request.permission)}`,
				`${escapeMarkdownV2(copy.permission.sessionLabel)}: ${escapeMarkdownV2(request.sessionID)}`,
				"",
				`${escapeMarkdownV2(copy.permission.patternsLabel)}:`,
				...patternLines.map((pattern) => `\\- ${escapeMarkdownV2(pattern)}`)
			].join("\n"),
			options: { parse_mode: "MarkdownV2" }
		},
		fallback: { text: plainText }
	};
}
function buildPermissionApprovalResolvedMessage(requestId, reply, copy = BOT_COPY) {
	return copy.permission.resolved(requestId, copy.permission.replyLabels[reply]);
}
function buildPermissionApprovalKeyboard(requestId, copy = BOT_COPY) {
	return { inline_keyboard: [[
		{
			text: copy.permission.allowOnce,
			callback_data: buildPermissionApprovalCallbackData("once", requestId)
		},
		{
			text: copy.permission.allowAlways,
			callback_data: buildPermissionApprovalCallbackData("always", requestId)
		},
		{
			text: copy.permission.reject,
			callback_data: buildPermissionApprovalCallbackData("reject", requestId)
		}
	]] };
}
function buildPermissionApprovalCallbackData(reply, requestId) {
	return `permission:${reply}:${requestId}`;
}
function parsePermissionApprovalCallbackData(data) {
	if (!data.startsWith("permission:")) return null;
	const [, reply, requestId] = data.split(":", 3);
	if (!requestId || !isPermissionApprovalReply(reply)) return null;
	return {
		reply,
		requestId
	};
}
function isPermissionApprovalReply(value) {
	return value === "once" || value === "always" || value === "reject";
}
function escapeMarkdownV2(value) {
	return value.replaceAll(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}
//#endregion
//#region src/app/plugin-events.ts
var PLUGIN_EVENT_HANDLERS = {
	"permission.asked": createPluginEventHandler(normalizePermissionRequestEvent, handlePermissionAsked),
	"permission.updated": createPluginEventHandler(normalizePermissionRequestEvent, handlePermissionAsked),
	"permission.replied": createPluginEventHandler(normalizePermissionReplyEvent, handlePermissionReplied),
	"session.error": createPluginEventHandler(normalizeSessionErrorEvent, handleSessionError),
	"session.idle": createPluginEventHandler(normalizeSessionIdleEvent, handleSessionIdle),
	"session.status": createPluginEventHandler(normalizeSessionStatusEvent, handleSessionStatus)
};
async function handleTelegramBotPluginEvent(runtime, event) {
	const handler = PLUGIN_EVENT_HANDLERS[event.type];
	if (!handler) return;
	const normalizedEvent = handler.normalize(event.properties);
	if (!normalizedEvent) return;
	await handler.handle(runtime, normalizedEvent);
}
async function handlePermissionAsked(runtime, request) {
	const logger = runtime.container.logger.child({
		component: "plugin-event",
		requestId: request.id,
		sessionId: request.sessionID
	});
	const bindings = await runtime.container.sessionRepo.listBySessionId(request.sessionID);
	const chatIds = new Set([...bindings.map((binding) => binding.chatId), ...runtime.container.foregroundSessionTracker.listChatIds(request.sessionID)]);
	const approvals = await runtime.container.permissionApprovalRepo.listByRequestId(request.id);
	const approvedChatIds = new Set(approvals.map((approval) => approval.chatId));
	for (const chatId of chatIds) {
		if (approvedChatIds.has(chatId)) continue;
		try {
			const message = await sendPermissionApprovalMessage(runtime, chatId, request, await getSafeChatCopy(runtime.container.sessionRepo, chatId, logger), logger);
			await runtime.container.permissionApprovalRepo.set({
				requestId: request.id,
				sessionId: request.sessionID,
				chatId,
				messageId: message.message_id,
				status: "pending",
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
		} catch (error) {
			logger.error({
				error,
				chatId,
				event: "plugin-event.permission.ask.delivery_failed",
				requestId: request.id
			}, "failed to deliver permission request to Telegram");
		}
	}
}
async function handlePermissionReplied(runtime, event) {
	const logger = runtime.container.logger.child({
		component: "plugin-event",
		event: "plugin-event.permission.replied",
		requestId: event.requestId,
		sessionId: event.sessionId
	});
	const approvals = await runtime.container.permissionApprovalRepo.listByRequestId(event.requestId);
	await Promise.all(approvals.map(async (approval) => {
		try {
			const copy = await getSafeChatCopy(runtime.container.sessionRepo, approval.chatId, logger);
			await runtime.bot.api.editMessageText(approval.chatId, approval.messageId, buildPermissionApprovalResolvedMessage(event.requestId, event.reply, copy));
		} catch (error) {
			logger.warn({
				error,
				chatId: approval.chatId,
				event: "plugin-event.permission.reply_message_failed"
			}, "failed to update Telegram permission message");
		}
		await runtime.container.permissionApprovalRepo.set(toResolvedApproval(approval, event.reply));
	}));
}
async function handleSessionError(runtime, event) {
	const logger = runtime.container.logger.child({
		component: "plugin-event",
		sessionId: event.sessionId
	});
	if (runtime.container.foregroundSessionTracker.fail(event.sessionId, normalizeForegroundSessionError(event.error))) {
		logger.warn({
			error: event.error,
			event: "plugin-event.session.error.foreground_suppressed"
		}, "session error suppressed for foreground Telegram session");
		return;
	}
	await notifyBoundChats(runtime, event.sessionId, async (chatId) => {
		const copy = await getSafeChatCopy(runtime.container.sessionRepo, chatId, logger);
		const message = extractSessionErrorMessage(event.error) ?? copy.sessionEvents.unknownError;
		return copy.sessionEvents.failed(event.sessionId, message);
	});
}
async function handleSessionIdle(runtime, event) {
	const logger = runtime.container.logger.child({
		component: "plugin-event",
		sessionId: event.sessionId
	});
	if (runtime.container.foregroundSessionTracker.clear(event.sessionId)) logPluginEvent(logger, { event: "plugin-event.session.idle.foreground_suppressed" }, "session idle notification suppressed for foreground Telegram session");
}
async function handleSessionStatus(runtime, event) {
	if (event.statusType !== "idle") return;
	await handleSessionIdle(runtime, event);
}
async function notifyBoundChats(runtime, sessionId, getText) {
	const logger = runtime.container.logger.child({
		component: "plugin-event",
		sessionId
	});
	const bindings = await runtime.container.sessionRepo.listBySessionId(sessionId);
	const chatIds = [...new Set(bindings.map((binding) => binding.chatId))];
	await Promise.all(chatIds.map(async (chatId) => {
		try {
			await runtime.bot.api.sendMessage(chatId, await getText(chatId));
		} catch (error) {
			logger.warn({
				error,
				chatId,
				event: "plugin-event.session.notify_failed"
			}, "failed to notify Telegram chat about session event");
		}
	}));
}
async function sendPermissionApprovalMessage(runtime, chatId, request, copy, logger) {
	const message = buildPermissionApprovalMessage(request, copy);
	const replyMarkup = buildPermissionApprovalKeyboard(request.id, copy);
	try {
		return await runtime.bot.api.sendMessage(chatId, message.preferred.text, {
			...message.preferred.options,
			reply_markup: replyMarkup
		});
	} catch (error) {
		logger.warn({
			error,
			chatId,
			event: "plugin-event.permission.ask.markdown_delivery_failed",
			requestId: request.id
		}, "failed to deliver MarkdownV2 permission request; retrying with plain text");
		return runtime.bot.api.sendMessage(chatId, message.fallback.text, { reply_markup: replyMarkup });
	}
}
function toResolvedApproval(approval, reply) {
	return {
		...approval,
		status: reply,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
function normalizePermissionRequestEvent(properties) {
	if (!isPlainRecord(properties)) return null;
	const id = asNonEmptyString(properties.id);
	const sessionID = asNonEmptyString(properties.sessionID);
	const permission = asNonEmptyString(properties.permission) ?? asNonEmptyString(properties.type);
	if (!id || !sessionID || !permission) return null;
	return {
		always: Array.isArray(properties.always) ? properties.always.filter((value) => typeof value === "string") : [],
		id,
		metadata: isPlainRecord(properties.metadata) ? properties.metadata : {},
		patterns: normalizePermissionPatterns(properties),
		permission,
		sessionID
	};
}
function normalizePermissionReplyEvent(properties) {
	if (!isPlainRecord(properties)) return null;
	const requestId = asNonEmptyString(properties.requestID) ?? asNonEmptyString(properties.permissionID);
	const reply = normalizePermissionReply(asNonEmptyString(properties.reply) ?? asNonEmptyString(properties.response));
	const sessionId = asNonEmptyString(properties.sessionID);
	if (!requestId || !reply || !sessionId) return null;
	return {
		reply,
		requestId,
		sessionId
	};
}
function normalizeSessionErrorEvent(properties) {
	if (!isPlainRecord(properties)) return null;
	const sessionId = asNonEmptyString(properties.sessionID);
	if (!sessionId) return null;
	return {
		error: properties.error,
		sessionId
	};
}
function normalizeSessionIdleEvent(properties) {
	if (!isPlainRecord(properties)) return null;
	const sessionId = asNonEmptyString(properties.sessionID);
	return sessionId ? { sessionId } : null;
}
function normalizeSessionStatusEvent(properties) {
	if (!isPlainRecord(properties) || !isPlainRecord(properties.status)) return null;
	const sessionId = asNonEmptyString(properties.sessionID);
	const statusType = asNonEmptyString(properties.status.type);
	if (!sessionId || !statusType) return null;
	return {
		sessionId,
		statusType
	};
}
function normalizePermissionPatterns(properties) {
	if (Array.isArray(properties.patterns)) return properties.patterns.filter((value) => typeof value === "string");
	if (typeof properties.pattern === "string" && properties.pattern.trim().length > 0) return [properties.pattern];
	if (Array.isArray(properties.pattern)) return properties.pattern.filter((value) => typeof value === "string");
	return [];
}
function normalizePermissionReply(value) {
	if (value === "once" || value === "always" || value === "reject") return value;
	return null;
}
function extractSessionErrorMessage(error) {
	if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
	if (!isPlainRecord(error)) return null;
	if (typeof error.message === "string" && error.message.trim().length > 0) return error.message.trim();
	if (isPlainRecord(error.data) && typeof error.data.message === "string" && error.data.message.trim().length > 0) return error.data.message.trim();
	return asNonEmptyString(error.name);
}
function normalizeForegroundSessionError(error) {
	if (error instanceof Error) return error;
	if (isPlainRecord(error)) {
		const normalized = new Error(extractSessionErrorMessage(error) ?? "Unknown session error.");
		const normalizedName = asNonEmptyString(error.name);
		if (normalizedName) normalized.name = normalizedName;
		if (isPlainRecord(error.data)) normalized.data = error.data;
		return normalized;
	}
	return /* @__PURE__ */ new Error("Unknown session error.");
}
function createPluginEventHandler(normalize, handle) {
	return {
		handle(runtime, event) {
			return handle(runtime, event);
		},
		normalize(properties) {
			return normalize(properties);
		}
	};
}
function asNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function isPlainRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
//#endregion
//#region src/bot/logger-context.ts
function buildTelegramLoggerContext(ctx, component = "telegram") {
	const updateId = typeof ctx.update?.update_id === "number" ? ctx.update.update_id : void 0;
	const command = extractTelegramCommand(resolveMessageText(ctx));
	const callbackData = normalizeTelegramString(ctx.callbackQuery?.data);
	const operationId = typeof updateId === "number" ? `telegram-${updateId}` : null;
	return {
		component,
		...typeof ctx.chat?.id === "number" ? { chatId: ctx.chat.id } : {},
		...typeof updateId === "number" ? { updateId } : {},
		...command ? { command } : {},
		...callbackData ? { callbackData } : {},
		correlationId: typeof updateId === "number" ? String(updateId) : operationId,
		operationId
	};
}
function scopeLoggerToTelegramContext(logger, ctx, component = "telegram") {
	return logger.child(buildTelegramLoggerContext(ctx, component));
}
function scopeDependenciesToTelegramContext(dependencies, ctx, component = "telegram") {
	return {
		...dependencies,
		logger: scopeLoggerToTelegramContext(dependencies.logger, ctx, component)
	};
}
function resolveMessageText(ctx) {
	return normalizeTelegramString(ctx.message?.text) ?? normalizeTelegramString(ctx.msg?.text);
}
function extractTelegramCommand(value) {
	if (!value || !value.startsWith("/")) return null;
	const token = value.split(/\s+/u, 1)[0]?.trim();
	if (!token) return null;
	return token.replace(/^\/+/u, "").split("@", 1)[0] ?? null;
}
function normalizeTelegramString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
var NUMBERED_BUTTONS_PER_ROW = 2;
function buildModelsKeyboard(models, requestedPage, copy = BOT_COPY) {
	const page = getModelsPage(models, requestedPage);
	const keyboard = buildNumberedKeyboard(page.items, page.startIndex, (_, index) => `model:pick:${page.startIndex + index + 1}`);
	appendPaginationButtons(keyboard, page.page, page.totalPages, "model:page", copy);
	return {
		keyboard,
		page
	};
}
function buildAgentsKeyboard(agents, requestedPage, copy = BOT_COPY) {
	const page = getAgentsPage(agents, requestedPage);
	const keyboard = buildNumberedKeyboard(page.items, page.startIndex, (_, index) => `agents:select:${page.startIndex + index + 1}`);
	appendPaginationButtons(keyboard, page.page, page.totalPages, "agents:page", copy);
	return {
		keyboard,
		page
	};
}
function buildSessionsKeyboard(sessions, requestedPage, copy = BOT_COPY) {
	const page = getSessionsPage(sessions, requestedPage);
	const keyboard = buildNumberedKeyboard(page.items, page.startIndex, (session) => `sessions:pick:${page.page}:${session.id}`);
	appendPaginationButtons(keyboard, page.page, page.totalPages, "sessions:page", copy);
	return {
		keyboard,
		page
	};
}
function buildSessionActionKeyboard(sessionId, page, copy = BOT_COPY) {
	return new InlineKeyboard().text(copy.sessions.switchAction, `sessions:switch:${page}:${sessionId}`).text(copy.sessions.renameAction, `sessions:rename:${page}:${sessionId}`).row().text(copy.sessions.backToList, `sessions:back:${page}`);
}
function buildModelVariantsKeyboard(variants, modelIndex) {
	return buildNumberedKeyboard(variants, 0, (_, index) => `model:variant:${modelIndex}:${index + 1}`);
}
function buildLanguageKeyboard(currentLanguage, copy = BOT_COPY) {
	const keyboard = new InlineKeyboard();
	SUPPORTED_BOT_LANGUAGES.forEach((language, index) => {
		const label = currentLanguage === language ? `[${getLanguageLabel(language, copy)}]` : getLanguageLabel(language, copy);
		keyboard.text(label, `language:select:${language}`);
		if (index !== SUPPORTED_BOT_LANGUAGES.length - 1) keyboard.row();
	});
	return keyboard;
}
function buildTokenSettingsKeyboard(showBreakdown, copy = BOT_COPY) {
	return new InlineKeyboard().text(showBreakdown ? `✓ ${copy.token.enabledLabel}` : copy.token.enabledLabel, "token:breakdown:on").text(showBreakdown ? copy.token.disabledLabel : `✓ ${copy.token.disabledLabel}`, "token:breakdown:off");
}
function getModelsPage(models, requestedPage) {
	return getPagedItems(models, requestedPage, 10);
}
function getAgentsPage(agents, requestedPage) {
	return getPagedItems(agents, requestedPage, 10);
}
function getSessionsPage(sessions, requestedPage) {
	return getPagedItems(sessions, requestedPage, 10);
}
function buildNumberedKeyboard(items, startIndex, buildCallbackData) {
	const keyboard = new InlineKeyboard();
	items.forEach((item, index) => {
		const displayIndex = startIndex + index + 1;
		keyboard.text(`${displayIndex}`, buildCallbackData(item, index));
		if (index !== items.length - 1 && (index + 1) % NUMBERED_BUTTONS_PER_ROW === 0) keyboard.row();
	});
	return keyboard;
}
function appendPaginationButtons(keyboard, page, totalPages, prefix, copy) {
	if (totalPages <= 1) return;
	if (page > 0) keyboard.text(copy.common.previousPage, `${prefix}:${page - 1}`);
	if (page < totalPages - 1) keyboard.text(copy.common.nextPage, `${prefix}:${page + 1}`);
}
function getPagedItems(items, requestedPage, pageSize) {
	const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
	const page = clampPage(requestedPage, totalPages);
	const startIndex = page * pageSize;
	return {
		items: items.slice(startIndex, startIndex + pageSize),
		page,
		startIndex,
		totalPages
	};
}
function clampPage(page, totalPages) {
	if (!Number.isInteger(page) || page < 0) return 0;
	return Math.min(page, totalPages - 1);
}
//#endregion
//#region src/bot/presenters/error.presenter.ts
function presentError(error, copy = BOT_COPY) {
	const presented = normalizeError(error, copy);
	return presented.cause ? `${presented.message}\n${copy.errors.causeLabel}: ${presented.cause}` : presented.message;
}
function normalizeError(error, copy) {
	if (isNamedError(error, "ProviderAuthError")) return {
		message: copy.errors.providerAuth,
		cause: extractMessage(error.data) ?? null
	};
	if (isNamedError(error, "MessageAbortedError")) return {
		message: copy.errors.requestAborted,
		cause: extractMessage(error.data) ?? null
	};
	if (isNamedError(error, "OpenCodePromptTimeoutError")) return {
		message: copy.errors.promptTimeout,
		cause: null
	};
	if (isNamedError(error, "StructuredOutputError")) return {
		message: copy.errors.structuredOutput,
		cause: joinNonEmptyParts([extractMessage(error.data), extractRetries(error.data)])
	};
	if (isNamedError(error, "ImageFileDownloadError")) return {
		message: copy.errors.imageDownload,
		cause: extractMessage(error.data) ?? null
	};
	if (isNamedError(error, "ImageMessageUnsupportedError")) return {
		message: copy.errors.imageUnsupported,
		cause: extractMessage(error.data) ?? null
	};
	if (isNamedError(error, "MessageOutputLengthError")) return {
		message: copy.errors.outputLength,
		cause: extractMessage(error.data) ?? null
	};
	if (isNamedError(error, "ContextOverflowError")) return {
		message: copy.errors.contextOverflow,
		cause: extractMessage(error.data) ?? null
	};
	if (isNamedError(error, "APIError")) {
		const providerMessage = extractMessage(error.data);
		return {
			message: copy.errors.providerRequest,
			cause: joinNonEmptyParts([
				getProviderCompatibilityHint(providerMessage),
				providerMessage,
				extractStatusCode(error.data, copy),
				extractRetryable(error.data, copy)
			])
		};
	}
	if (isNamedError(error, "NotFoundError")) return {
		message: copy.errors.notFound,
		cause: extractMessage(error.data) ?? null
	};
	if (isBadRequestError(error)) return {
		message: copy.errors.badRequest,
		cause: extractBadRequestCause(error)
	};
	if (error instanceof Error) return {
		message: error.name === "AbortError" ? copy.errors.requestAborted : copy.errors.unexpected,
		cause: error.message || null
	};
	return {
		message: copy.errors.unexpected,
		cause: extractMessage(error) ?? stringifyUnknown(error)
	};
}
function getProviderCompatibilityHint(message) {
	if (!message) return null;
	return /tool_choice parameter does not support being set to required or object in thinking mode/iu.test(message) ? "Current model/reasoning mode is incompatible with tool calling. Switch to a compatible model or disable thinking mode." : null;
}
function isBadRequestError(error) {
	return !!error && typeof error === "object" && "success" in error && error.success === false;
}
function isNamedError(error, name) {
	return !!error && typeof error === "object" && "name" in error && error.name === name;
}
function extractBadRequestCause(error) {
	const directMessage = extractMessage(error.data);
	if (directMessage) return directMessage;
	return Array.isArray(error.errors) && error.errors.length > 0 ? stringifyUnknown(error.errors[0]) : null;
}
function extractMessage(value) {
	if (!value) return null;
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "object" && "message" in value) {
		const message = value.message;
		return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
	}
	return null;
}
function extractRetries(value) {
	if (!value || typeof value !== "object" || !("retries" in value)) return null;
	const retries = value.retries;
	return typeof retries === "number" && Number.isFinite(retries) ? `retries: ${Math.round(retries)}` : null;
}
function extractRetryable(value, copy) {
	if (!value || typeof value !== "object" || !("isRetryable" in value)) return null;
	const isRetryable = value.isRetryable;
	return typeof isRetryable === "boolean" ? `${copy.errors.retryableLabel}: ${isRetryable ? "yes" : "no"}` : null;
}
function extractStatusCode(value, copy) {
	if (!value || typeof value !== "object" || !("statusCode" in value)) return null;
	const statusCode = value.statusCode;
	return typeof statusCode === "number" && Number.isFinite(statusCode) ? `${copy.errors.statusCodeLabel}: ${Math.round(statusCode)}` : null;
}
function joinNonEmptyParts(parts) {
	const filtered = parts.map((part) => part?.trim()).filter((part) => !!part);
	return filtered.length > 0 ? filtered.join(" | ") : null;
}
function stringifyUnknown(value) {
	if (value === null || value === void 0) return null;
	if (typeof value === "string") return value.trim() || null;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	try {
		const text = JSON.stringify(value);
		return text && text !== "{}" ? text : null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/bot/presenters/message.presenter.ts
var VARIANT_ORDER = [
	"minimal",
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
function presentStatusMessage(input, copy = BOT_COPY) {
	const layout = getStatusLayoutCopy(copy);
	return presentStatusSections([
		presentStatusPlainSection(layout.overviewTitle, presentStatusPlainOverviewLines(input, copy, layout)),
		presentStatusPlainSection(layout.workspaceTitle, presentStatusPlainWorkspaceLines(input, copy, layout)),
		presentStatusPlainSection(layout.pluginsTitle, presentStatusPlainPluginLines(input, copy, layout)),
		presentStatusPlainSection(layout.mcpTitle, presentStatusPlainMcpLines(input, copy, layout)),
		presentStatusPlainSection(layout.lspTitle, presentStatusPlainLspLines(input, copy, layout))
	]);
}
function presentStatusMarkdownMessage(input, copy = BOT_COPY) {
	const layout = getStatusLayoutCopy(copy);
	return presentStatusSections([
		presentStatusMarkdownSection(layout.overviewTitle, presentStatusMarkdownOverviewLines(input, copy, layout)),
		presentStatusMarkdownSection(layout.workspaceTitle, presentStatusMarkdownWorkspaceLines(input, copy, layout)),
		presentStatusMarkdownSection(layout.pluginsTitle, presentStatusMarkdownPluginLines(input, copy, layout)),
		presentStatusMarkdownSection(layout.mcpTitle, presentStatusMarkdownMcpLines(input, copy, layout)),
		presentStatusMarkdownSection(layout.lspTitle, presentStatusMarkdownLspLines(input, copy, layout))
	]);
}
function presentStatusSections(sections) {
	return sections.flatMap((section, index) => index === 0 ? [section] : ["", section]).join("\n");
}
function presentStatusPlainSection(title, lines) {
	return [title, ...lines].join("\n");
}
function presentStatusMarkdownSection(title, lines) {
	return [`## ${title}`, ...lines].join("\n");
}
function presentStatusPlainOverviewLines(input, copy, layout) {
	const lines = [presentPlainStatusBullet(layout.connectivityLabel, input.health.status === "error" ? layout.errorStatus : formatHealthBadge(input.health.data.healthy, layout))];
	if (input.health.status === "error") return [
		...lines,
		...presentStatusPlainErrorDetailLines(input.health.error, copy, layout),
		presentPlainStatusBullet(layout.tbotVersionLabel, OPENCODE_TBOT_VERSION)
	];
	return [
		...lines,
		presentPlainStatusBullet(layout.openCodeVersionLabel, input.health.data.version),
		presentPlainStatusBullet(layout.tbotVersionLabel, OPENCODE_TBOT_VERSION)
	];
}
function presentStatusMarkdownOverviewLines(input, copy, layout) {
	const lines = [presentMarkdownStatusBullet(layout.connectivityLabel, input.health.status === "error" ? layout.errorStatus : formatHealthBadge(input.health.data.healthy, layout))];
	if (input.health.status === "error") return [
		...lines,
		...presentStatusMarkdownErrorDetailLines(input.health.error, copy, layout),
		presentMarkdownStatusBullet(layout.tbotVersionLabel, OPENCODE_TBOT_VERSION)
	];
	return [
		...lines,
		presentMarkdownStatusBullet(layout.openCodeVersionLabel, input.health.data.version),
		presentMarkdownStatusBullet(layout.tbotVersionLabel, OPENCODE_TBOT_VERSION)
	];
}
function presentStatusPlainWorkspaceLines(input, copy, layout) {
	if (input.workspace.status === "error") return presentStatusPlainErrorLines(input.workspace.error, copy, layout);
	return [presentPlainStatusBullet(layout.currentProjectLabel, input.workspace.data.currentProject), presentPlainStatusBullet(layout.currentSessionLabel, input.workspace.data.currentSession ?? layout.defaultSessionValue)];
}
function presentStatusMarkdownWorkspaceLines(input, copy, layout) {
	if (input.workspace.status === "error") return presentStatusMarkdownErrorLines(input.workspace.error, copy, layout);
	return [presentMarkdownStatusBullet(layout.currentProjectLabel, input.workspace.data.currentProject, { codeValue: true }), presentMarkdownStatusBullet(layout.currentSessionLabel, input.workspace.data.currentSession ?? layout.defaultSessionValue)];
}
function presentStatusPlainPluginLines(input, copy, layout) {
	if (input.plugins.status === "error") return presentStatusPlainErrorLines(input.plugins.error, copy, layout);
	if (input.plugins.data.plugins.length === 0) return [...presentPlainEmptyStatusLines(layout.noPluginsMessage, layout)];
	return input.plugins.data.plugins.map((plugin) => `- ${plugin}`);
}
function presentStatusMarkdownPluginLines(input, copy, layout) {
	if (input.plugins.status === "error") return presentStatusMarkdownErrorLines(input.plugins.error, copy, layout);
	if (input.plugins.data.plugins.length === 0) return [...presentMarkdownEmptyStatusLines(layout.noPluginsMessage, layout)];
	return input.plugins.data.plugins.map((plugin) => `- \`${plugin}\``);
}
function presentStatusPlainLspLines(input, copy, layout) {
	if (input.lsp.status === "error") return presentStatusPlainErrorLines(input.lsp.error, copy, layout);
	if (input.lsp.data.statuses.length === 0) return presentPlainEmptyStatusLines(copy.lsp.none, layout);
	return input.lsp.data.statuses.flatMap((status) => presentPlainStatusGroup(status.name, [{
		label: layout.statusLabel,
		value: formatLspStatusBadge(status)
	}]));
}
function presentStatusMarkdownLspLines(input, copy, layout) {
	if (input.lsp.status === "error") return presentStatusMarkdownErrorLines(input.lsp.error, copy, layout);
	if (input.lsp.data.statuses.length === 0) return presentMarkdownEmptyStatusLines(copy.lsp.none, layout);
	return input.lsp.data.statuses.flatMap((status) => presentMarkdownStatusGroup(status.name, [{
		label: layout.statusLabel,
		value: formatLspStatusBadge(status)
	}]));
}
function presentStatusPlainMcpLines(input, copy, layout) {
	if (input.mcp.status === "error") return presentStatusPlainErrorLines(input.mcp.error, copy, layout);
	if (input.mcp.data.statuses.length === 0) return presentPlainEmptyStatusLines(copy.mcp.none, layout);
	return input.mcp.data.statuses.flatMap(({ name, status }) => presentPlainStatusGroup(name, getMcpStatusDetailLines(status, copy, layout)));
}
function presentStatusMarkdownMcpLines(input, copy, layout) {
	if (input.mcp.status === "error") return presentStatusMarkdownErrorLines(input.mcp.error, copy, layout);
	if (input.mcp.data.statuses.length === 0) return presentMarkdownEmptyStatusLines(copy.mcp.none, layout);
	return input.mcp.data.statuses.flatMap(({ name, status }) => presentMarkdownStatusGroup(name, getMcpStatusDetailLines(status, copy, layout), { codeName: true }));
}
function presentStatusPlainErrorLines(error, copy, layout) {
	return [presentPlainStatusBullet(layout.statusLabel, layout.errorStatus), ...presentStatusPlainErrorDetailLines(error, copy, layout)];
}
function presentStatusPlainErrorDetailLines(error, copy, layout) {
	return splitStatusLines(presentError(error, copy)).map((line) => presentPlainStatusBullet(layout.detailsLabel, line));
}
function presentStatusMarkdownErrorLines(error, copy, layout) {
	return [presentMarkdownStatusBullet(layout.statusLabel, layout.errorStatus), ...presentStatusMarkdownErrorDetailLines(error, copy, layout)];
}
function presentStatusMarkdownErrorDetailLines(error, copy, layout) {
	return splitStatusLines(presentError(error, copy)).map((line) => presentMarkdownStatusBullet(layout.detailsLabel, line));
}
function presentPlainEmptyStatusLines(message, layout) {
	return [presentPlainStatusBullet(layout.statusLabel, layout.noneStatus), presentPlainStatusBullet(layout.detailsLabel, message)];
}
function presentMarkdownEmptyStatusLines(message, layout) {
	return [presentMarkdownStatusBullet(layout.statusLabel, layout.noneStatus), presentMarkdownStatusBullet(layout.detailsLabel, message)];
}
function presentPlainStatusGroup(name, details) {
	return [`- ${normalizeStatusInlineValue(name)}`, ...details.map((detail) => `  - ${detail.label}: ${formatStatusValue(detail.value)}`)];
}
function presentMarkdownStatusGroup(name, details, options = {}) {
	return [`- ${options.codeName ? `\`${normalizeStatusInlineValue(name)}\`` : `**${normalizeStatusInlineValue(name)}**`}`, ...details.map((detail) => detail.codeValue ? `  - **${detail.label}:** \`${formatStatusValue(detail.value)}\`` : `  - **${detail.label}:** ${formatStatusValue(detail.value)}`)];
}
function presentPlainStatusBullet(label, value) {
	return `- ${label}: ${formatStatusValue(value)}`;
}
function presentMarkdownStatusBullet(label, value, options = {}) {
	return options.codeValue ? `- **${label}:** \`${formatStatusValue(value)}\`` : `- **${label}:** ${formatStatusValue(value)}`;
}
function splitStatusLines(text) {
	return text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
}
function formatHealthBadge(healthy, layout) {
	return healthy ? "🟢" : layout.errorStatus;
}
function formatLspStatusBadge(status) {
	switch (status.status) {
		case "connected": return "🟢";
		case "error": return "🔴";
	}
	return status.status;
}
function formatMcpStatusBadge(status, layout) {
	switch (status.status) {
		case "connected": return "🟢";
		case "disabled": return "⚪";
		case "needs_auth": return "🟡";
		case "failed": return layout.mcpFailedStatus;
		case "needs_client_registration": return layout.mcpRegistrationRequiredStatus;
	}
	return status;
}
function getMcpStatusDetailLines(status, copy, layout) {
	const notes = formatMcpStatusNotes(status, copy, layout);
	return notes ? [{
		label: layout.statusLabel,
		value: formatMcpStatusBadge(status, layout)
	}, {
		label: layout.mcpNotesLabel,
		value: notes
	}] : [{
		label: layout.statusLabel,
		value: formatMcpStatusBadge(status, layout)
	}];
}
function formatMcpStatusNotes(status, copy, layout) {
	switch (status.status) {
		case "connected": return null;
		case "disabled": return null;
		case "needs_auth": return copy.mcp.needsAuth;
		case "failed": return status.error;
		case "needs_client_registration": return status.error;
	}
	return status;
}
function formatStatusValue(value) {
	const normalized = value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter((line) => line.length > 0).join(" / ");
	return normalized.length > 0 ? normalized : "-";
}
function normalizeStatusInlineValue(value) {
	return formatStatusValue(value);
}
function getStatusLayoutCopy(copy) {
	if (copy.locale === "en") return {
		connectivityLabel: "Connectivity",
		currentProjectLabel: "Current Project",
		currentSessionLabel: "Current Session",
		defaultSessionValue: "OpenCode Default",
		detailsLabel: "Details",
		errorStatus: "🔴",
		lspTitle: "🧠 LSP",
		mcpFailedStatus: "🔴",
		mcpNotesLabel: "Notes",
		mcpRegistrationRequiredStatus: "🟡",
		mcpTitle: "🔌 MCP",
		noPluginsMessage: "No npm plugins configured in OpenCode.",
		noneStatus: "⚪",
		openCodeVersionLabel: "OpenCode Version",
		overviewTitle: "🖥️ Overview",
		pluginsTitle: "🧩 Plugins",
		statusLabel: "Status",
		tbotVersionLabel: "opencode-tbot Version",
		workspaceTitle: "📁 Workspace"
	};
	if (copy.locale === "ja") return {
		connectivityLabel: "接続性",
		currentProjectLabel: "現在のプロジェクト",
		currentSessionLabel: "現在のセッション",
		defaultSessionValue: "OpenCode のデフォルト",
		detailsLabel: "詳細",
		errorStatus: "🔴",
		lspTitle: "🧠 LSP",
		mcpFailedStatus: "🔴",
		mcpNotesLabel: "補足",
		mcpRegistrationRequiredStatus: "🟡",
		mcpTitle: "🔌 MCP",
		noPluginsMessage: "OpenCode に npm プラグインが設定されていません。",
		noneStatus: "⚪",
		openCodeVersionLabel: "OpenCode バージョン",
		overviewTitle: "🖥️ 概要",
		pluginsTitle: "🧩 プラグイン",
		statusLabel: "状態",
		tbotVersionLabel: "opencode-tbot バージョン",
		workspaceTitle: "📁 ワークスペース"
	};
	return {
		connectivityLabel: "连通性",
		currentProjectLabel: "当前项目",
		currentSessionLabel: "当前会话",
		defaultSessionValue: "OpenCode 默认",
		detailsLabel: "详情",
		errorStatus: "🔴",
		lspTitle: "🧠 LSP",
		mcpFailedStatus: "🔴",
		mcpNotesLabel: "说明",
		mcpRegistrationRequiredStatus: "🟡",
		mcpTitle: "🔌 MCP",
		noPluginsMessage: "当前 OpenCode 中未配置 npm 插件。",
		noneStatus: "⚪",
		openCodeVersionLabel: "OpenCode版本",
		overviewTitle: "🖥️ 概览",
		pluginsTitle: "🧩 插件",
		statusLabel: "状态",
		tbotVersionLabel: "opencode-tbot版本",
		workspaceTitle: "📁 工作区"
	};
}
function presentSessionsMessage(input, copy = BOT_COPY) {
	if (input.sessions.length === 0) return copy.sessions.none;
	const page = getSessionsPage(input.sessions, input.page);
	const currentSession = input.currentSessionId ? input.sessions.find((session) => session.id === input.currentSessionId) ?? null : null;
	return [
		copy.sessions.title,
		copy.sessions.currentProject(input.currentDirectory),
		copy.sessions.currentSession(currentSession ? formatSessionLabel(currentSession) : copy.common.notSelected),
		copy.common.page(page.page + 1, page.totalPages),
		"",
		...page.items.map((session, index) => `${page.startIndex + index + 1}. ${formatSessionLabel(session)}`)
	].join("\n");
}
function presentSessionSwitchMessage(session, copy = BOT_COPY) {
	return [copy.sessions.switched, copy.sessions.currentSession(formatSessionLabel(session))].join("\n");
}
function presentSessionCreatedMessage(session, copy = BOT_COPY) {
	return [copy.sessions.created, copy.sessions.currentSession(formatSessionLabel(session))].join("\n");
}
function presentSessionActionsMessage(input, copy = BOT_COPY) {
	return [
		copy.sessions.actionTitle,
		copy.sessions.currentProject(input.currentDirectory),
		copy.sessions.selectedSession(formatSessionLabel(input.session)),
		"",
		copy.sessions.chooseAction
	].join("\n");
}
function presentSessionRenamePromptMessage(session, copy = BOT_COPY) {
	return copy.sessions.renamePrompt(formatSessionLabel(session));
}
function presentSessionRenamedMessage(session, copy = BOT_COPY) {
	return [copy.sessions.renamed, copy.sessions.currentSession(formatSessionLabel(session))].join("\n");
}
function presentAgentsMessage(input, copy = BOT_COPY) {
	if (input.agents.length === 0) return copy.agents.none;
	const page = getAgentsPage(input.agents, input.page);
	const currentAgent = input.currentAgentName ? input.agents.find((agent) => agent.name === input.currentAgentName) ?? null : null;
	return [
		copy.agents.title,
		copy.agents.current(currentAgent ? formatAgentLabel(currentAgent) : copy.common.openCodeDefault),
		copy.common.page(page.page + 1, page.totalPages),
		"",
		...page.items.map((agent, index) => `${page.startIndex + index + 1}. ${formatAgentLabel(agent)}`)
	].join("\n");
}
function presentAgentSwitchMessage(agent, copy = BOT_COPY) {
	return [copy.agents.switched, copy.agents.current(formatAgentLabel(agent))].join("\n");
}
function presentModelsMessage(input, copy = BOT_COPY) {
	if (input.models.length === 0) return copy.models.none;
	const page = getModelsPage(input.models, input.page);
	const currentModel = input.currentModelId && input.currentModelProviderId ? input.models.find((model) => model.id === input.currentModelId && model.providerID === input.currentModelProviderId) ?? null : null;
	const currentModelLine = currentModel ? formatModelSelection(currentModel, input.currentModelVariant, copy) : copy.common.openCodeDefault;
	return [
		copy.models.title,
		copy.models.configuredOnly,
		copy.models.current(currentModelLine),
		copy.common.page(page.page + 1, page.totalPages),
		"",
		...page.items.map((model, index) => formatModelListLine(model, page.startIndex + index + 1))
	].join("\n");
}
function presentModelVariantsMessage(model, modelIndex, copy = BOT_COPY) {
	const variants = getModelVariants(model);
	if (variants.length === 0) return [copy.models.noReasoningLevels, copy.models.model(formatModelLabel(model))].join("\n");
	return [
		copy.models.reasoningLevelsTitle,
		copy.models.model(formatModelLabel(model)),
		copy.models.modelNumber(modelIndex),
		"",
		...variants.map((variant, index) => `${index + 1}. ${variant}`)
	].join("\n");
}
function presentModelSwitchMessage(model, variant, copy = BOT_COPY) {
	return [
		copy.models.switched,
		copy.models.current(formatModelLabel(model)),
		copy.models.currentReasoningLevel(variant ?? copy.models.defaultReasoningLevel)
	].join("\n");
}
function presentTokenSettingsMessage(showBreakdown, copy = BOT_COPY) {
	return [
		copy.token.title,
		copy.token.description,
		copy.token.scopeNotice,
		"",
		copy.token.currentStatus(showBreakdown ? copy.token.enabledLabel : copy.token.disabledLabel),
		copy.token.footerSummary,
		copy.token.footerBreakdown
	].join("\n");
}
function presentLanguageMessage(currentLanguage, copy = BOT_COPY) {
	return [
		copy.language.title,
		copy.language.current(getLanguageLabel(currentLanguage, copy)),
		"",
		copy.language.choose
	].join("\n");
}
function presentLanguageSwitchMessage(currentLanguage, copy = BOT_COPY) {
	return [copy.language.switched, copy.language.current(getLanguageLabel(currentLanguage, copy))].join("\n");
}
function getModelVariants(model) {
	return Object.keys(model.variants).sort((left, right) => compareVariantNames(left, right));
}
function compareVariantNames(left, right) {
	const leftIndex = VARIANT_ORDER.indexOf(left);
	const rightIndex = VARIANT_ORDER.indexOf(right);
	if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
	if (leftIndex === -1) return 1;
	if (rightIndex === -1) return -1;
	return leftIndex - rightIndex;
}
function formatAgentLabel(agent) {
	return agent.name;
}
function formatModelListLine(model, displayIndex) {
	return `${displayIndex}. ${formatModelLabel(model)}`;
}
function formatModelSelection(model, variant, copy) {
	return `${formatModelLabel(model)} | ${copy.models.reasoningLevel(variant ?? copy.models.defaultReasoningLevel)}`;
}
function formatModelLabel(model) {
	return `${model.providerName} / ${model.name}`;
}
function formatSessionLabel(session) {
	const slug = session.slug?.trim() || session.id;
	const title = session.title.trim() || slug || session.id;
	return title === slug ? title : `${title} [${slug}]`;
}
//#endregion
//#region src/bot/commands/agents.ts
async function handleAgentsCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const result = await dependencies.listAgentsUseCase.execute({ chatId: ctx.chat.id });
		if (result.agents.length === 0) {
			await ctx.reply(copy.agents.none);
			return;
		}
		const { keyboard, page } = buildAgentsKeyboard(result.agents, 0, copy);
		await ctx.reply(presentAgentsMessage({
			agents: result.agents,
			currentAgentName: result.currentAgentName,
			page: page.page
		}, copy), { reply_markup: keyboard });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to list agents");
		await ctx.reply(presentError(error, copy));
	}
}
function registerAgentsCommand(bot, dependencies) {
	bot.command(["agents", "agent"], async (ctx) => {
		await handleAgentsCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var AGENTS_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.agents;
	},
	names: ["agents", "agent"],
	register: registerAgentsCommand
};
//#endregion
//#region src/bot/sessions-menu.ts
async function buildSessionsListView(chatId, requestedPage, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, chatId, dependencies.logger);
	const result = await dependencies.listSessionsUseCase.execute({ chatId });
	if (result.sessions.length === 0) return {
		copy,
		currentDirectory: result.currentDirectory,
		currentSessionId: result.currentSessionId,
		page: 0,
		sessions: [],
		text: copy.sessions.none
	};
	const { keyboard, page } = buildSessionsKeyboard(result.sessions, requestedPage, copy);
	return {
		copy,
		currentDirectory: result.currentDirectory,
		currentSessionId: result.currentSessionId,
		keyboard,
		page: page.page,
		sessions: result.sessions,
		text: presentSessionsMessage({
			currentDirectory: result.currentDirectory,
			currentSessionId: result.currentSessionId,
			page: page.page,
			sessions: result.sessions
		}, copy)
	};
}
async function buildSessionActionView(chatId, requestedPage, sessionId, dependencies) {
	const listView = await buildSessionsListView(chatId, requestedPage, dependencies);
	const session = listView.sessions.find((item) => item.id === sessionId);
	if (!session) return {
		copy: listView.copy,
		found: false
	};
	return {
		copy: listView.copy,
		found: true,
		keyboard: buildSessionActionKeyboard(session.id, listView.page, listView.copy),
		page: listView.page,
		session,
		text: presentSessionActionsMessage({
			currentDirectory: listView.currentDirectory,
			session
		}, listView.copy)
	};
}
async function restoreSessionsListMessage(api, chatId, messageId, requestedPage, dependencies) {
	const listView = await buildSessionsListView(chatId, requestedPage, dependencies);
	if (listView.keyboard) await api.editMessageText(chatId, messageId, listView.text, { reply_markup: listView.keyboard });
	else await api.editMessageText(chatId, messageId, listView.text);
	return listView;
}
//#endregion
//#region src/bot/session-rename.ts
async function getPendingSessionRenameAction(dependencies, chatId) {
	const action = await dependencies.pendingActionRepo.getByChatId(chatId);
	return isSessionRenamePendingAction(action) ? action : null;
}
async function replyIfSessionRenamePending(ctx, dependencies) {
	if (!await getPendingSessionRenameAction(dependencies, ctx.chat.id)) return false;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	await ctx.reply(copy.sessions.renamePendingInput);
	return true;
}
async function handlePendingSessionRenameText(ctx, dependencies) {
	const pendingAction = await getPendingSessionRenameAction(dependencies, ctx.chat.id);
	if (!pendingAction) return false;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	const title = ctx.message.text?.trim() ?? "";
	if (title.startsWith("/")) {
		await ctx.reply(copy.sessions.renamePendingInput);
		return true;
	}
	if (!title) {
		await ctx.reply(copy.sessions.renameEmpty);
		return true;
	}
	try {
		const result = await dependencies.renameSessionUseCase.execute({
			chatId: ctx.chat.id,
			sessionId: pendingAction.sessionId,
			title
		});
		await dependencies.pendingActionRepo.clear(ctx.chat.id);
		await bestEffortRestoreSessionsList(ctx.api, pendingAction, dependencies);
		if (!result.found) {
			await ctx.reply(copy.sessions.renameExpired);
			return true;
		}
		await ctx.reply(presentSessionRenamedMessage(result.session, copy));
	} catch (error) {
		dependencies.logger.error({ error }, "failed to rename session");
		await ctx.reply(presentError(error, copy));
	}
	return true;
}
async function cancelPendingSessionRename(ctx, dependencies) {
	const pendingAction = await getPendingSessionRenameAction(dependencies, ctx.chat.id);
	if (!pendingAction) return false;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	await dependencies.pendingActionRepo.clear(ctx.chat.id);
	await bestEffortRestoreSessionsList(ctx.api, pendingAction, dependencies);
	await ctx.reply(copy.sessions.renameCancelled);
	return true;
}
async function bestEffortRestoreSessionsList(api, pendingAction, dependencies) {
	try {
		await restoreSessionsListMessage(api, pendingAction.chatId, pendingAction.menuMessageId, pendingAction.returnPage, dependencies);
	} catch (error) {
		dependencies.logger.warn?.({ error }, "failed to restore sessions list message");
	}
}
function isSessionRenamePendingAction(action) {
	return action?.kind === "session_rename";
}
//#endregion
//#region src/bot/commands/cancel.ts
async function handleCancelCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		if (await cancelPendingSessionRename(ctx, dependencies)) return;
		const result = await dependencies.abortPromptUseCase.execute({ chatId: ctx.chat.id });
		if (result.status === "no_session") {
			await ctx.reply(copy.abort.noSession);
			return;
		}
		if (result.status === "not_running") {
			await ctx.reply(copy.abort.notRunning);
			return;
		}
		await ctx.reply(copy.abort.aborted);
	} catch (error) {
		dependencies.logger.error({ error }, "failed to cancel current action");
		await ctx.reply(presentError(error, copy));
	}
}
function registerCancelCommand(bot, dependencies) {
	bot.command("cancel", async (ctx) => {
		await handleCancelCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var CANCEL_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.cancel;
	},
	names: ["cancel"],
	register: registerCancelCommand
};
//#endregion
//#region src/bot/commands/language.ts
async function handleLanguageCommand(ctx, dependencies) {
	const language = await getSafeChatLanguage(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		await syncTelegramCommandsForChat(ctx.api, ctx.chat.id, language);
		await ctx.reply(presentLanguageMessage(language, copy), { reply_markup: buildLanguageKeyboard(language, copy) });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to show language options");
		await ctx.reply(presentError(error, copy));
	}
}
async function switchLanguageForChat(api, chatId, language, dependencies) {
	const currentCopy = await getSafeChatCopy(dependencies.sessionRepo, chatId, dependencies.logger);
	if (!isBotLanguage(language)) return {
		found: false,
		copy: currentCopy
	};
	await setChatLanguage(dependencies.sessionRepo, chatId, language);
	await syncTelegramCommandsForChat(api, chatId, language);
	return {
		found: true,
		copy: await getSafeChatCopy(dependencies.sessionRepo, chatId, dependencies.logger),
		language
	};
}
async function presentLanguageSwitchForChat(chatId, api, language, dependencies) {
	const result = await switchLanguageForChat(api, chatId, language, dependencies);
	if (!result.found) return {
		found: false,
		copy: result.copy,
		text: result.copy.language.expired,
		keyboard: buildLanguageKeyboard(await getSafeChatLanguage(dependencies.sessionRepo, chatId, dependencies.logger), result.copy)
	};
	return {
		found: true,
		copy: result.copy,
		text: presentLanguageSwitchMessage(result.language, result.copy),
		keyboard: buildLanguageKeyboard(result.language, result.copy)
	};
}
function registerLanguageCommand(bot, dependencies) {
	bot.command("language", async (ctx) => {
		await handleLanguageCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var LANGUAGE_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.language;
	},
	names: ["language"],
	register: registerLanguageCommand
};
//#endregion
//#region src/bot/commands/models.ts
async function handleModelsCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const result = await dependencies.listModelsUseCase.execute({ chatId: ctx.chat.id });
		if (result.models.length === 0) {
			await ctx.reply(copy.models.none);
			return;
		}
		const { keyboard, page } = buildModelsKeyboard(result.models, 0, copy);
		await ctx.reply(presentModelsMessage({
			currentModelId: result.currentModelId,
			currentModelProviderId: result.currentModelProviderId,
			currentModelVariant: result.currentModelVariant,
			models: result.models,
			page: page.page
		}, copy), { reply_markup: keyboard });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to list models");
		await ctx.reply(presentError(error, copy));
	}
}
function registerModelsCommand(bot, dependencies) {
	bot.command(["model", "models"], async (ctx) => {
		await handleModelsCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var MODELS_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.model;
	},
	names: ["model", "models"],
	register: registerModelsCommand
};
//#endregion
//#region src/bot/commands/new.ts
async function handleNewCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const title = extractSessionTitle(ctx);
		const result = await dependencies.createSessionUseCase.execute({
			chatId: ctx.chat.id,
			title
		});
		await ctx.reply(presentSessionCreatedMessage(result.session, copy));
	} catch (error) {
		dependencies.logger.error({ error }, "failed to create new session");
		await ctx.reply(presentError(error, copy));
	}
}
function registerNewCommand(bot, dependencies) {
	bot.command("new", async (ctx) => {
		await handleNewCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var NEW_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.new;
	},
	names: ["new"],
	register: registerNewCommand
};
function extractSessionTitle(ctx) {
	if (typeof ctx.match === "string") {
		const title = ctx.match.trim();
		return title ? title : null;
	}
	const messageText = ctx.message?.text?.trim();
	if (!messageText) return null;
	const title = messageText.match(/^\/new(?:@\S+)?(?:\s+([\s\S]*))?$/i)?.[1]?.trim();
	return title ? title : null;
}
//#endregion
//#region src/bot/commands/sessions.ts
async function handleSessionsCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		await dependencies.pendingActionRepo.clear(ctx.chat.id);
		const view = await buildSessionsListView(ctx.chat.id, 0, dependencies);
		await ctx.reply(view.text, view.keyboard ? { reply_markup: view.keyboard } : void 0);
	} catch (error) {
		dependencies.logger.error({ error }, "failed to list sessions");
		await ctx.reply(presentError(error, copy));
	}
}
function registerSessionsCommand(bot, dependencies) {
	bot.command("sessions", async (ctx) => {
		await handleSessionsCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var SESSIONS_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.sessions;
	},
	names: ["sessions"],
	register: registerSessionsCommand
};
//#endregion
//#region src/services/telegram/telegram-format.ts
var MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
var TRUNCATED_SUFFIX = "...";
var MARKDOWN_SPECIAL_CHARACTERS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;
function buildTelegramPromptReply(result, copy = BOT_COPY, options = {}) {
	const renderedMarkdown = result.bodyMd ? renderMarkdownToTelegramMarkdownV2(result.bodyMd) : null;
	const footerPlain = formatPlainMetricsFooter(result.metrics, copy, options);
	const fallback = { text: joinBodyAndFooter(truncatePlainBody(normalizePlainBody(result, copy), footerPlain), footerPlain) };
	if (!renderedMarkdown) return {
		preferred: fallback,
		fallback
	};
	const markdownText = joinBodyAndFooter(renderedMarkdown, formatMarkdownMetricsFooter(result.metrics, copy, options));
	if (markdownText.length > MAX_TELEGRAM_MESSAGE_LENGTH) return {
		preferred: fallback,
		fallback
	};
	return {
		preferred: {
			text: markdownText,
			options: { parse_mode: "MarkdownV2" }
		},
		fallback
	};
}
function buildTelegramStaticReply(markdown) {
	const renderedMarkdown = renderMarkdownToTelegramMarkdownV2(markdown);
	const fallback = { text: truncateStaticText(stripMarkdownToPlainText(markdown) || markdown.trim()) };
	if (!renderedMarkdown || renderedMarkdown.length > MAX_TELEGRAM_MESSAGE_LENGTH) return {
		preferred: fallback,
		fallback
	};
	return {
		preferred: {
			text: renderedMarkdown,
			options: { parse_mode: "MarkdownV2" }
		},
		fallback
	};
}
function renderMarkdownToTelegramMarkdownV2(markdown) {
	const normalizedMarkdown = preprocessMarkdownForTelegram(markdown).trim();
	if (!normalizedMarkdown) return null;
	const lines = normalizedMarkdown.split("\n");
	const rendered = [];
	let inCodeBlock = false;
	let codeBlockLanguage = "";
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const fenceMatch = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
		if (fenceMatch) {
			if (inCodeBlock) {
				rendered.push("```");
				inCodeBlock = false;
				codeBlockLanguage = "";
			} else {
				codeBlockLanguage = fenceMatch[1] ?? "";
				rendered.push(`\`\`\`${codeBlockLanguage}`);
				inCodeBlock = true;
			}
			continue;
		}
		if (inCodeBlock) {
			rendered.push(escapeCodeContent(line));
			continue;
		}
		if (line.includes("![")) return null;
		const tableBlock = consumeMarkdownTable(lines, index);
		if (tableBlock) {
			rendered.push(renderTableAsTelegramCodeBlock(tableBlock.rows));
			index = tableBlock.nextIndex - 1;
			continue;
		}
		if (/<[/A-Za-z][^>]*>/.test(line)) return null;
		if (!line.trim()) {
			rendered.push("");
			continue;
		}
		const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			rendered.push(`*${escapeMarkdownText(headingMatch[2].trim())}*`);
			continue;
		}
		const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
		if (blockquoteMatch) {
			const quote = renderInlineMarkdown(blockquoteMatch[1]);
			if (quote === null) return null;
			rendered.push(`>${quote ? ` ${quote}` : ""}`);
			continue;
		}
		const unorderedListMatch = line.match(/^(\s*)[-+*]\s+(.+)$/);
		if (unorderedListMatch) {
			const item = renderInlineMarkdown(unorderedListMatch[2]);
			if (item === null) return null;
			rendered.push(`${unorderedListMatch[1]}\\- ${item}`);
			continue;
		}
		const orderedListMatch = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
		if (orderedListMatch) {
			const item = renderInlineMarkdown(orderedListMatch[3]);
			if (item === null) return null;
			rendered.push(`${orderedListMatch[1]}${orderedListMatch[2]}\\. ${item}`);
			continue;
		}
		const paragraph = renderInlineMarkdown(line);
		if (paragraph === null) return null;
		rendered.push(paragraph);
	}
	if (inCodeBlock) return null;
	return rendered.join("\n");
}
function normalizePlainBody(result, copy) {
	const fromStructured = result.bodyMd ? stripMarkdownToPlainText(result.bodyMd) : "";
	const fromFallback = result.fallbackText.trim();
	return (fromStructured || fromFallback).trim() || result.fallbackText || copy.prompt.emptyResponse;
}
function truncatePlainBody(body, footer) {
	const reservedLength = footer.length + 2;
	const maxBodyLength = Math.max(0, MAX_TELEGRAM_MESSAGE_LENGTH - reservedLength);
	if (body.length <= maxBodyLength) return body;
	return `${body.slice(0, Math.max(0, maxBodyLength - 3))}${TRUNCATED_SUFFIX}`;
}
function truncateStaticText(text) {
	if (text.length <= MAX_TELEGRAM_MESSAGE_LENGTH) return text;
	return `${text.slice(0, Math.max(0, MAX_TELEGRAM_MESSAGE_LENGTH - 3))}${TRUNCATED_SUFFIX}`;
}
function joinBodyAndFooter(body, footer) {
	return `${body}\n\n${footer}`;
}
function preprocessMarkdownForTelegram(markdown) {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const processed = [];
	let activeFence = null;
	for (const line of lines) {
		const fenceMatch = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
		if (fenceMatch) {
			const language = (fenceMatch[1] ?? "").toLowerCase();
			if (activeFence === "markdown") {
				activeFence = null;
				continue;
			}
			if (activeFence === "plain") {
				processed.push(line);
				activeFence = null;
				continue;
			}
			if (language === "md" || language === "markdown") {
				activeFence = "markdown";
				continue;
			}
			activeFence = "plain";
			processed.push(line);
			continue;
		}
		processed.push(line);
	}
	return processed.join("\n");
}
function formatPlainMetricsFooter(metrics, copy, options) {
	const lines = [`${copy.replyMetrics.durationLabel}: ${formatDuration(metrics.durationMs, copy)} | ${copy.replyMetrics.tokensLabel}: ${formatMetricValue(metrics.tokens.total, copy)}`];
	if (options.showBreakdown) lines.push(formatPlainTokenBreakdown(metrics, copy));
	return lines.join("\n");
}
function formatMarkdownMetricsFooter(metrics, copy, options) {
	return escapeMarkdownText(formatPlainMetricsFooter(metrics, copy, options));
}
function formatPlainTokenBreakdown(metrics, copy) {
	return [
		`${copy.replyMetrics.inputLabel}: ${formatMetricValue(metrics.tokens.input, copy)}`,
		`${copy.replyMetrics.outputLabel}: ${formatMetricValue(metrics.tokens.output, copy)}`,
		`${copy.replyMetrics.reasoningLabel}: ${formatMetricValue(metrics.tokens.reasoning, copy)}`,
		`${copy.replyMetrics.cacheReadLabel}: ${formatMetricValue(metrics.tokens.cacheRead, copy)}`,
		`${copy.replyMetrics.cacheWriteLabel}: ${formatMetricValue(metrics.tokens.cacheWrite, copy)}`
	].join(" | ");
}
function formatDuration(durationMs, copy) {
	if (durationMs === null || !Number.isFinite(durationMs)) return copy.replyMetrics.notAvailable;
	if (durationMs < 1e3) return `${Math.round(durationMs)} ms`;
	return `${(durationMs / 1e3).toFixed(1)} s`;
}
function formatMetricValue(value, copy) {
	if (value === null || !Number.isFinite(value)) return copy.replyMetrics.notAvailable;
	return `${Math.round(value)}`;
}
function consumeMarkdownTable(lines, startIndex) {
	if (startIndex + 1 >= lines.length) return null;
	const headerCells = parseMarkdownTableRow(lines[startIndex]);
	const separatorCells = parseMarkdownTableSeparator(lines[startIndex + 1]);
	if (!headerCells || !separatorCells || headerCells.length !== separatorCells.length) return null;
	const rows = [headerCells];
	let index = startIndex + 2;
	while (index < lines.length) {
		const rowCells = parseMarkdownTableRow(lines[index]);
		if (!rowCells || rowCells.length !== headerCells.length) break;
		rows.push(rowCells);
		index += 1;
	}
	return {
		rows,
		nextIndex: index
	};
}
function parseMarkdownTableRow(line) {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) return null;
	const cells = splitMarkdownTableCells(trimmed).map((cell) => normalizeTableCell(cell));
	return cells.length >= 2 ? cells : null;
}
function parseMarkdownTableSeparator(line) {
	const cells = splitMarkdownTableCells(line.trim());
	if (cells.length < 2) return null;
	return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim())) ? cells : null;
}
function splitMarkdownTableCells(line) {
	const content = line.replace(/^\|/, "").replace(/\|$/, "");
	const cells = [];
	let current = "";
	let escaped = false;
	for (const char of content) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			current += char;
			continue;
		}
		if (char === "|") {
			cells.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current);
	return cells;
}
function normalizeTableCell(cell) {
	return cell.trim().replace(/\\\|/g, "|").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(.*?)\1/g, "$2").replace(/`([^`]+)`/g, "$1");
}
function renderTableAsTelegramCodeBlock(rows) {
	return [
		"```",
		...buildAlignedTableLines(rows).map((line) => escapeCodeContent(line)),
		"```"
	].join("\n");
}
function buildAlignedTableLines(rows) {
	const columnWidths = calculateTableColumnWidths(rows);
	return [
		formatTableRow(rows[0], columnWidths),
		columnWidths.map((width) => "-".repeat(Math.max(3, width))).join("-+-"),
		...rows.slice(1).map((row) => formatTableRow(row, columnWidths))
	];
}
function calculateTableColumnWidths(rows) {
	return rows[0].map((_, columnIndex) => rows.reduce((maxWidth, row) => Math.max(maxWidth, getDisplayWidth(row[columnIndex] ?? "")), 0));
}
function formatTableRow(row, columnWidths) {
	return row.map((cell, index) => padDisplayWidth(cell, columnWidths[index] ?? 0)).join(" | ");
}
function padDisplayWidth(value, targetWidth) {
	const padding = Math.max(0, targetWidth - getDisplayWidth(value));
	return `${value}${" ".repeat(padding)}`;
}
function getDisplayWidth(value) {
	let width = 0;
	for (const char of value) width += isWideCharacter(char.codePointAt(0) ?? 0) ? 2 : 1;
	return width;
}
function isWideCharacter(codePoint) {
	return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510);
}
function renderInlineMarkdown(input) {
	let output = "";
	let cursor = 0;
	while (cursor < input.length) {
		if (input.startsWith("![", cursor)) return null;
		if (input.startsWith("**", cursor) || input.startsWith("__", cursor)) {
			const delimiter = input.slice(cursor, cursor + 2);
			const closingIndex = input.indexOf(delimiter, cursor + 2);
			if (closingIndex > cursor + 2) {
				output += `*${escapeMarkdownText(input.slice(cursor + 2, closingIndex))}*`;
				cursor = closingIndex + 2;
				continue;
			}
		}
		if (input[cursor] === "*" || input[cursor] === "_") {
			const delimiter = input[cursor];
			const closingIndex = input.indexOf(delimiter, cursor + 1);
			if (closingIndex > cursor + 1) {
				output += `_${escapeMarkdownText(input.slice(cursor + 1, closingIndex))}_`;
				cursor = closingIndex + 1;
				continue;
			}
		}
		if (input[cursor] === "`") {
			const closingIndex = input.indexOf("`", cursor + 1);
			if (closingIndex === -1) return null;
			output += `\`${escapeCodeContent(input.slice(cursor + 1, closingIndex))}\``;
			cursor = closingIndex + 1;
			continue;
		}
		if (input[cursor] === "[") {
			const linkMatch = input.slice(cursor).match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
			if (!linkMatch) return null;
			output += `[${escapeMarkdownText(linkMatch[1])}](${escapeLinkDestination(linkMatch[2])})`;
			cursor += linkMatch[0].length;
			continue;
		}
		output += escapeMarkdownText(input[cursor]);
		cursor += 1;
	}
	return output;
}
function escapeMarkdownText(text) {
	return text.replace(MARKDOWN_SPECIAL_CHARACTERS, "\\$1");
}
function escapeCodeContent(text) {
	return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
}
function escapeLinkDestination(url) {
	return url.replace(/\\/g, "\\\\").replace(/\)/g, "\\)").replace(/\(/g, "\\(");
}
//#endregion
//#region src/bot/presenters/static.presenter.ts
function presentStartMarkdownMessage(copy = BOT_COPY) {
	return copy.start.lines.join("\n");
}
//#endregion
//#region src/bot/commands/start.ts
async function handleStartCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat?.id, dependencies.logger);
	const reply = buildTelegramStaticReply(presentStartMarkdownMessage(copy));
	try {
		await ctx.reply(reply.preferred.text, reply.preferred.options);
	} catch (error) {
		if (reply.preferred.options) {
			dependencies.logger.error({ error }, "failed to send start markdown reply, falling back to plain text");
			await ctx.reply(reply.fallback.text);
			return;
		}
		dependencies.logger.error({ error }, "failed to show start message");
		await ctx.reply(presentError(error, copy));
	}
}
function registerStartCommand(bot, dependencies) {
	bot.command("start", async (ctx) => {
		await handleStartCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var START_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.start;
	},
	names: ["start"],
	register: registerStartCommand
};
//#endregion
//#region src/bot/commands/status.ts
async function handleStatusCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat?.id, dependencies.logger);
	try {
		const result = await dependencies.getStatusUseCase.execute({ chatId: ctx.chat?.id ?? 0 });
		const renderedMarkdown = renderMarkdownToTelegramMarkdownV2(presentStatusMarkdownMessage(result, copy));
		if (renderedMarkdown) {
			await ctx.reply(renderedMarkdown, { parse_mode: "MarkdownV2" });
			return;
		}
		await ctx.reply(presentStatusMessage(result, copy));
	} catch (error) {
		dependencies.logger.error({ error }, "failed to fetch system status");
		await ctx.reply(presentError(error, copy));
	}
}
function registerStatusCommand(bot, dependencies) {
	bot.command("status", async (ctx) => {
		await handleStatusCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var STATUS_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.status;
	},
	names: ["status"],
	register: registerStatusCommand
};
//#endregion
//#region src/bot/commands/token.ts
async function handleTokenCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const settings = await dependencies.getTokenSettingsUseCase.execute();
		await ctx.reply(presentTokenSettingsMessage(settings.showBreakdown, copy), { reply_markup: buildTokenSettingsKeyboard(settings.showBreakdown, copy) });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to show token settings");
		await ctx.reply(presentError(error, copy));
	}
}
function registerTokenCommand(bot, dependencies) {
	bot.command("token", async (ctx) => {
		await handleTokenCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var TOKEN_COMMAND_DEFINITION = {
	describe(copy) {
		return copy.commands.token;
	},
	names: ["token"],
	register: registerTokenCommand
};
//#endregion
//#region src/bot/image
var IMAGE_TOOL_DIR = "/root/image-gen-tools";
var IMAGE_TOOL_PY = IMAGE_TOOL_DIR + "/.venv/bin/python";
var IMAGE_TOOL_SCRIPT = IMAGE_TOOL_DIR + "/bing_gen.py";
function parseImageFlags(raw) {
	const flags = { count: 1, model: "dall-e-3", aspect: "square", pptx: false };
	const tokens = raw.split(/\s+/);
	const promptParts = [];
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--pptx") {
			flags.pptx = true;
			continue;
		}
		if ((t === "--count" || t === "--model" || t === "--aspect") && i + 1 < tokens.length) {
			const val = tokens[++i];
			if (t === "--count" && /^\d+$/.test(val)) flags.count = Math.min(4, Math.max(1, Number(val)));
			else if (t === "--model" && ["dall-e-3", "gpt-4o", "mai-1"].includes(val)) flags.model = val;
			else if (t === "--aspect" && ["square", "landscape", "portrait"].includes(val)) flags.aspect = val;
			continue;
		}
		promptParts.push(t);
	}
	return { prompt: promptParts.join(" ").trim(), flags };
}
async function registerImageCommand(bot, dependencies) {
	bot.command("image", async (ctx) => {
		const raw = String(ctx.match ?? "").trim();
		const { prompt, flags } = parseImageFlags(raw);
		if (!prompt) {
			await ctx.reply("用法：/image <描述> [--count N] [--model dall-e-3|gpt-4o|mai-1] [--aspect square|landscape|portrait] [--pptx]\n\n範例：/image 一張日落山谷 --count 2 --pptx");
			return;
		}
		const args = [IMAGE_TOOL_SCRIPT, "generate", "--count", String(flags.count), "--model", flags.model, "--aspect", flags.aspect];
		if (flags.pptx) args.push("--pptx");
		args.push(prompt);
		try {
			const { execFile } = await import("node:child_process");
			const execFileAsync = (file, argv, opts) => new Promise((resolve, reject) => {
				execFile(file, argv, opts, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve({ stdout }));
			});
			const { stdout } = await execFileAsync(IMAGE_TOOL_PY, args, { cwd: IMAGE_TOOL_DIR, timeout: 300000 });
			const res = JSON.parse(stdout);
			const allFiles = [...(res.files ?? []), ...(res.pptx_files ?? [])];
			let photoSent = false;
			if (allFiles.length) {
				try {
					const media = allFiles.slice(0, 10).map((f) => ({ type: "photo", media: new InputFile(f) }));
					media[0].caption = `${res.prompt}\n模型: ${res.model} / ${res.aspect}${flags.pptx ? " (+16:9 pptx)" : ""}`;
					await ctx.replyWithMediaGroup(media);
					photoSent = true;
				} catch (e) {
					photoSent = false;
				}
			}
			const lines = [`已生成 ${res.count} 張（${res.model}/${res.aspect}，${res.latency}s）`, ""];
			if (photoSent) lines.push("圖片已傳至上方相簿。");
			lines.push("", "檔案:");
			for (const f of allFiles) lines.push(`- ${f}`);
			await ctx.reply(lines.join("\n"));
		} catch (err) {
			const stderr = err?.stderr || err?.message || String(err);
			if (/cookie|AuthCookieError|auth_failed/i.test(stderr)) {
				await ctx.reply("❌ Bing cookie 已失效或達生成限制。請重新登入 https://www.bing.com/images/create 抓取新 cookies 更新 config.json（約每 2-4 週需更新）。");
			} else {
				await ctx.reply(`❌ 圖片生成失敗：${stderr}`);
			}
		}
	});
}
var IMAGE_COMMAND_DEFINITION = {
	describe() {
		return "Generate AI images (Bing Image Creator)";
	},
	names: ["image"],
	register: registerImageCommand
};
//#endregion
//#region src/bot/commands/registry.ts
function getTelegramCommandDefinitions() {
	return [
		START_COMMAND_DEFINITION,
		STATUS_COMMAND_DEFINITION,
		NEW_COMMAND_DEFINITION,
		AGENTS_COMMAND_DEFINITION,
		SESSIONS_COMMAND_DEFINITION,
		CANCEL_COMMAND_DEFINITION,
		MODELS_COMMAND_DEFINITION,
		TOKEN_COMMAND_DEFINITION,
		LANGUAGE_COMMAND_DEFINITION,
		TODO_COMMAND_DEFINITION,
		TODO_DONE_COMMAND_DEFINITION,
		SETTODO_COLS_COMMAND_DEFINITION,
		IMAGE_COMMAND_DEFINITION
	];
}
function registerTelegramCommands(bot, dependencies) {
	for (const definition of getTelegramCommandDefinitions()) definition.register(bot, dependencies);
}
//#endregion
//#region src/bot/commands/command-list.ts
function getTelegramCommands(language = "en") {
	const copy = getBotCopy(language);
	return getTelegramCommandDefinitions().map((definition) => ({
		command: definition.names[0],
		description: definition.describe(copy)
	}));
}
//#endregion
//#region src/bot/commands/sync-commands.ts
var TELEGRAM_COMMAND_SYNC_SCOPES = [{ type: "default" }, { type: "all_private_chats" }];
async function syncTelegramCommands(bot, logger) {
	const commands = getTelegramCommands();
	await Promise.all(TELEGRAM_COMMAND_SYNC_SCOPES.map((scope) => bot.api.setMyCommands(commands, { scope })));
	logger.info({
		component: "runtime",
		commands: commands.map((command) => command.command),
		event: "runtime.commands.synced",
		scopes: TELEGRAM_COMMAND_SYNC_SCOPES.map((scope) => scope.type)
	}, "telegram commands synced");
}
async function syncTelegramCommandsForChat(api, chatId, language) {
	await api.setMyCommands(getTelegramCommands(language), { scope: {
		type: "chat",
		chat_id: chatId
	} });
}
//#endregion
//#region src/bot/error-boundary.ts
function extractTelegramUpdateContext(ctx) {
	return buildTelegramLoggerContext({
		callbackQuery: { data: getNestedString(ctx, ["callbackQuery", "data"]) },
		chat: { id: getNestedNumber(ctx, ["chat", "id"]) ?? void 0 },
		message: { text: getNestedString(ctx, ["message", "text"]) },
		update: { update_id: getNestedNumber(ctx, ["update", "update_id"]) ?? void 0 }
	});
}
async function replyWithDefaultTelegramError(ctx, logger, error) {
	const text = presentError(error, BOT_COPY);
	const editMessageText = getFunction(ctx, "editMessageText");
	const reply = getFunction(ctx, "reply");
	const callbackData = getNestedString(ctx, ["callbackQuery", "data"]);
	try {
		if (typeof callbackData === "string" && editMessageText) {
			await editMessageText.call(ctx, text);
			return;
		}
		if (reply) await reply.call(ctx, text);
	} catch (replyError) {
		logger.warn?.({
			...extractTelegramUpdateContext(ctx),
			error: replyError
		}, "failed to deliver fallback Telegram error message");
	}
}
function getFunction(value, key) {
	if (!(key in value)) return null;
	const candidate = value[key];
	return typeof candidate === "function" ? candidate : null;
}
function getNestedNumber(value, path) {
	const candidate = getNestedValue(value, path);
	return typeof candidate === "number" ? candidate : null;
}
function getNestedString(value, path) {
	const candidate = getNestedValue(value, path);
	return typeof candidate === "string" ? candidate : null;
}
function getNestedValue(value, path) {
	let current = value;
	for (const segment of path) {
		if (!current || typeof current !== "object" || !(segment in current)) return null;
		current = current[segment];
	}
	return current;
}
//#endregion
//#region src/bot/handlers/callbacks/agents-callback.handler.ts
var AGENTS_PAGE_PREFIX = "agents:page:";
var AGENTS_SELECT_PREFIX = "agents:select:";
async function handleAgentsCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith("agents:")) return;
	await ctx.answerCallbackQuery();
	if (!ctx.chat) return;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		if (data.startsWith(AGENTS_PAGE_PREFIX)) {
			const requestedPage = Number(data.slice(12));
			const result = await dependencies.listAgentsUseCase.execute({ chatId: ctx.chat.id });
			if (result.agents.length === 0) {
				await ctx.editMessageText(copy.agents.none);
				return;
			}
			const { keyboard, page } = buildAgentsKeyboard(result.agents, requestedPage, copy);
			await ctx.editMessageText(presentAgentsMessage({
				agents: result.agents,
				currentAgentName: result.currentAgentName,
				page: page.page
			}, copy), { reply_markup: keyboard });
			return;
		}
		if (data.startsWith(AGENTS_SELECT_PREFIX)) {
			const agentIndex = Number(data.slice(14));
			const agent = (await dependencies.listAgentsUseCase.execute({ chatId: ctx.chat.id })).agents[agentIndex - 1];
			if (!agent) {
				await ctx.editMessageText(copy.agents.expired);
				return;
			}
			const switchResult = await dependencies.switchAgentUseCase.execute({
				chatId: ctx.chat.id,
				agentName: agent.name
			});
			if (!switchResult.found) {
				await ctx.editMessageText(copy.agents.expired);
				return;
			}
			await ctx.editMessageText(presentAgentSwitchMessage(switchResult.agent, copy));
		}
	} catch (error) {
		dependencies.logger.error({ error }, "failed to handle agent callback");
		await ctx.editMessageText(presentError(error, copy));
	}
}
function registerAgentsCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^agents:/, async (ctx) => {
		await handleAgentsCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/handlers/callbacks/language-callback.handler.ts
var LANGUAGE_SELECT_PREFIX = "language:select:";
async function handleLanguageCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith("language:")) return;
	await ctx.answerCallbackQuery();
	if (!ctx.chat || !ctx.api) return;
	const currentCopy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		if (!data.startsWith(LANGUAGE_SELECT_PREFIX)) {
			await ctx.editMessageText(presentLanguageMessage(await getSafeChatLanguage(dependencies.sessionRepo, ctx.chat.id, dependencies.logger), currentCopy), { reply_markup: buildLanguageKeyboard(await getSafeChatLanguage(dependencies.sessionRepo, ctx.chat.id, dependencies.logger), currentCopy) });
			return;
		}
		const selectedLanguage = data.slice(16);
		const result = await presentLanguageSwitchForChat(ctx.chat.id, ctx.api, selectedLanguage, dependencies);
		await ctx.editMessageText(result.text, { reply_markup: result.keyboard });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to handle language callback");
		await ctx.editMessageText(presentError(error, currentCopy));
	}
}
function registerLanguageCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^language:/, async (ctx) => {
		await handleLanguageCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/handlers/callbacks/models-callback.handler.ts
var MODEL_PAGE_PREFIX = "model:page:";
var MODEL_PICK_PREFIX = "model:pick:";
var MODEL_VARIANT_PREFIX = "model:variant:";
async function handleModelsCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith("model:")) return;
	await ctx.answerCallbackQuery();
	if (!ctx.chat) return;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		if (data.startsWith(MODEL_PAGE_PREFIX)) {
			const requestedPage = Number(data.slice(11));
			const result = await dependencies.listModelsUseCase.execute({ chatId: ctx.chat.id });
			if (result.models.length === 0) {
				await ctx.editMessageText(copy.models.none);
				return;
			}
			const { keyboard, page } = buildModelsKeyboard(result.models, requestedPage, copy);
			await ctx.editMessageText(presentModelsMessage({
				currentModelId: result.currentModelId,
				currentModelProviderId: result.currentModelProviderId,
				currentModelVariant: result.currentModelVariant,
				models: result.models,
				page: page.page
			}, copy), { reply_markup: keyboard });
			return;
		}
		if (data.startsWith(MODEL_PICK_PREFIX)) {
			const modelIndex = Number(data.slice(11));
			const model = (await dependencies.listModelsUseCase.execute({ chatId: ctx.chat.id })).models[modelIndex - 1];
			if (!model) {
				await ctx.editMessageText(copy.models.expired);
				return;
			}
			const variants = getModelVariants(model);
			if (variants.length === 0) {
				const switchResult = await dependencies.switchModelUseCase.execute({
					chatId: ctx.chat.id,
					providerId: model.providerID,
					modelId: model.id
				});
				if (!switchResult.found) {
					await ctx.editMessageText(copy.models.expired);
					return;
				}
				await ctx.editMessageText(presentModelSwitchMessage(switchResult.model, switchResult.variant, copy));
				return;
			}
			await ctx.editMessageText(presentModelVariantsMessage(model, modelIndex, copy), { reply_markup: buildModelVariantsKeyboard(variants, modelIndex) });
			return;
		}
		if (data.startsWith(MODEL_VARIANT_PREFIX)) {
			const [modelIndexRaw, variantIndexRaw] = data.slice(14).split(":");
			const modelIndex = Number(modelIndexRaw);
			const variantIndex = Number(variantIndexRaw);
			const model = (await dependencies.listModelsUseCase.execute({ chatId: ctx.chat.id })).models[modelIndex - 1];
			if (!model) {
				await ctx.editMessageText(copy.models.expired);
				return;
			}
			const variant = getModelVariants(model)[variantIndex - 1];
			if (!variant) {
				await ctx.editMessageText(copy.models.reasoningLevelExpired);
				return;
			}
			const switchResult = await dependencies.switchModelUseCase.execute({
				chatId: ctx.chat.id,
				providerId: model.providerID,
				modelId: model.id,
				variant
			});
			if (!switchResult.found) {
				await ctx.editMessageText(copy.models.expired);
				return;
			}
			await ctx.editMessageText(presentModelSwitchMessage(switchResult.model, switchResult.variant, copy));
		}
	} catch (error) {
		dependencies.logger.error({ error }, "failed to handle model callback");
		await ctx.editMessageText(presentError(error, copy));
	}
}
function registerModelsCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^model:/, async (ctx) => {
		await handleModelsCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/handlers/callbacks/token-callback.handler.ts
var TOKEN_BREAKDOWN_PREFIX = "token:breakdown:";
async function handleTokenCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith("token:")) return;
	if (!ctx.chat) {
		await ctx.answerCallbackQuery();
		return;
	}
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		if (!data.startsWith(TOKEN_BREAKDOWN_PREFIX)) {
			const settings = await dependencies.getTokenSettingsUseCase.execute();
			await ctx.answerCallbackQuery();
			await ctx.editMessageText(presentTokenSettingsMessage(settings.showBreakdown, copy), { reply_markup: buildTokenSettingsKeyboard(settings.showBreakdown, copy) });
			return;
		}
		const showBreakdown = data === "token:breakdown:on";
		const result = await dependencies.toggleTokenSettingUseCase.execute({ showBreakdown });
		await ctx.answerCallbackQuery();
		await ctx.editMessageText(presentTokenSettingsMessage(result.showBreakdown, copy), { reply_markup: buildTokenSettingsKeyboard(result.showBreakdown, copy) });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to handle token callback");
		await ctx.answerCallbackQuery();
		await ctx.editMessageText(presentError(error, copy));
	}
}
function registerTokenCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^token:/, async (ctx) => {
		await handleTokenCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/handlers/callbacks/permission-approval-callback.handler.ts
var PERMISSION_PREFIX = "permission:";
async function handlePermissionApprovalCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith(PERMISSION_PREFIX)) return;
	await ctx.answerCallbackQuery();
	if (!ctx.chat) return;
	const parsed = parsePermissionApprovalCallbackData(data);
	if (!parsed) return;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const approval = (await dependencies.permissionApprovalRepo.listByRequestId(parsed.requestId)).find((item) => item.chatId === ctx.chat?.id);
		if (!approval) {
			await ctx.editMessageText(copy.permission.replyFailed);
			return;
		}
		if (!await dependencies.opencodeClient.replyToPermission(approval.sessionId, parsed.requestId, parsed.reply)) {
			await ctx.editMessageText(copy.permission.replyFailed);
			return;
		}
		await dependencies.permissionApprovalRepo.set({
			...approval,
			status: parsed.reply,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		await ctx.editMessageText(buildPermissionApprovalResolvedMessage(parsed.requestId, parsed.reply, copy));
	} catch (error) {
		dependencies.logger.error({
			error,
			requestId: parsed.requestId
		}, "failed to reply to permission request");
		await ctx.editMessageText(copy.permission.replyFailed);
	}
}
function registerPermissionApprovalCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^permission:/, async (ctx) => {
		await handlePermissionApprovalCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/handlers/callbacks/sessions-callback.handler.ts
var SESSIONS_PAGE_PREFIX = "sessions:page:";
var SESSIONS_PICK_PREFIX = "sessions:pick:";
var SESSIONS_SWITCH_PREFIX = "sessions:switch:";
var SESSIONS_RENAME_PREFIX = "sessions:rename:";
var SESSIONS_BACK_PREFIX = "sessions:back:";
async function handleSessionsCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith("sessions:")) return;
	await ctx.answerCallbackQuery();
	if (!ctx.chat) return;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		if (data.startsWith(SESSIONS_PAGE_PREFIX)) {
			const requestedPage = Number(data.slice(14));
			const view = await buildSessionsListView(ctx.chat.id, requestedPage, dependencies);
			await ctx.editMessageText(view.text, view.keyboard ? { reply_markup: view.keyboard } : void 0);
			return;
		}
		if (data.startsWith(SESSIONS_BACK_PREFIX)) {
			const requestedPage = Number(data.slice(14));
			const view = await buildSessionsListView(ctx.chat.id, requestedPage, dependencies);
			await ctx.editMessageText(view.text, view.keyboard ? { reply_markup: view.keyboard } : void 0);
			return;
		}
		if (data.startsWith(SESSIONS_PICK_PREFIX)) {
			const target = parseSessionActionTarget(data, SESSIONS_PICK_PREFIX);
			if (!target) {
				await ctx.editMessageText(copy.sessions.expired);
				return;
			}
			const view = await buildSessionActionView(ctx.chat.id, target.page, target.sessionId, dependencies);
			if (!view.found) {
				await ctx.editMessageText(copy.sessions.expired);
				return;
			}
			await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
			return;
		}
		if (data.startsWith(SESSIONS_SWITCH_PREFIX)) {
			const target = parseSessionActionTarget(data, SESSIONS_SWITCH_PREFIX);
			if (!target) {
				await ctx.editMessageText(copy.sessions.expired);
				return;
			}
			const result = await dependencies.switchSessionUseCase.execute({
				chatId: ctx.chat.id,
				sessionId: target.sessionId
			});
			if (!result.found) {
				await ctx.editMessageText(copy.sessions.expired);
				return;
			}
			await ctx.editMessageText(presentSessionSwitchMessage(result.session, copy));
			return;
		}
		if (data.startsWith(SESSIONS_RENAME_PREFIX)) {
			const target = parseSessionActionTarget(data, SESSIONS_RENAME_PREFIX);
			if (!target) {
				await ctx.editMessageText(copy.sessions.renameExpired);
				return;
			}
			const view = await buildSessionActionView(ctx.chat.id, target.page, target.sessionId, dependencies);
			if (!view.found) {
				await ctx.editMessageText(copy.sessions.renameExpired);
				return;
			}
			const menuMessageId = ctx.callbackQuery.message?.message_id;
			if (typeof menuMessageId !== "number" || !Number.isInteger(menuMessageId)) {
				await ctx.editMessageText(copy.sessions.renameExpired);
				return;
			}
			await dependencies.pendingActionRepo.set({
				chatId: ctx.chat.id,
				kind: "session_rename",
				sessionId: view.session.id,
				menuMessageId,
				returnPage: view.page,
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
			await ctx.editMessageText(presentSessionRenamePromptMessage(view.session, copy));
		}
	} catch (error) {
		dependencies.logger.error({ error }, "failed to handle session callback");
		await ctx.editMessageText(presentError(error, copy));
	}
}
function registerSessionsCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^sessions:/, async (ctx) => {
		await handleSessionsCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
function parseSessionActionTarget(data, prefix) {
	const suffix = data.slice(prefix.length);
	const separatorIndex = suffix.indexOf(":");
	if (separatorIndex === -1) return null;
	const page = Number(suffix.slice(0, separatorIndex));
	const sessionId = suffix.slice(separatorIndex + 1).trim();
	if (!Number.isInteger(page) || page < 0 || !sessionId) return null;
	return {
		page,
		sessionId
	};
}
//#endregion
//#region src/bot/handlers/callback.handler.ts
var CALLBACK_ROUTE_REGISTRARS = [
	registerAgentsCallbackRoute,
	registerSessionsCallbackRoute,
	registerModelsCallbackRoute,
	registerTokenCallbackRoute,
	registerLanguageCallbackRoute,
	registerPermissionApprovalCallbackRoute,
	registerTodoCallbackRoute
];
function registerCallbackHandler(bot, dependencies) {
	for (const registerRoute of CALLBACK_ROUTE_REGISTRARS) registerRoute(bot, dependencies);
}
//#endregion
//#region src/bot/handlers/prompt.handler.ts
async function executePromptRequest(ctx, dependencies, resolvePrompt) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	const foregroundRequest = dependencies.foregroundSessionTracker.acquire(ctx.chat.id);
	if (!foregroundRequest) {
		await ctx.reply(copy.status.alreadyProcessing);
		return;
	}
	let processingMessage = null;
	let sentTerminalReply = false;
	try {
		processingMessage = await ctx.reply(copy.status.processing);
		const promptInput = await resolvePrompt();
		const result = await dependencies.sendPromptUseCase.execute({
			chatId: ctx.chat.id,
			files: promptInput.files,
			onExecutionSession: (sessionId) => {
				foregroundRequest.attachSession(sessionId);
			},
			signal: foregroundRequest.signal,
			text: promptInput.text
		});
		const tokenSettings = await dependencies.getTokenSettingsUseCase.execute();
		const telegramReply = buildTelegramPromptReply(normalizePromptReplyForDisplay(result.assistantReply, tokenSettings.showBreakdown, copy), copy, { showBreakdown: tokenSettings.showBreakdown });
		try {
			await ctx.reply(telegramReply.preferred.text, telegramReply.preferred.options);
		} catch (replyError) {
			dependencies.logger.warn?.({ error: replyError }, "failed to send preferred telegram reply, falling back to plain text");
			await ctx.reply(telegramReply.fallback.text, telegramReply.fallback.options);
		}
		sentTerminalReply = true;
	} catch (error) {
		dependencies.logger.error({ error }, "failed to handle prompt request");
		await ctx.reply(presentError(error, copy));
		sentTerminalReply = true;
	} finally {
		foregroundRequest.dispose();
		if (processingMessage && sentTerminalReply) try {
			await ctx.api.deleteMessage(ctx.chat.id, processingMessage.message_id);
		} catch (error) {
			dependencies.logger.warn?.({ error }, "failed to delete processing message");
		}
	}
}
function normalizePromptReplyForDisplay(promptReply, _showBreakdown, copy) {
	const displayedTokenTotal = calculateDisplayedTokenTotal(promptReply.metrics.tokens);
	if (!promptReply.assistantError) return withDisplayedTokenTotal(promptReply, displayedTokenTotal);
	return withDisplayedTokenTotal({
		...promptReply,
		bodyMd: null,
		fallbackText: presentError(promptReply.assistantError, copy)
	}, displayedTokenTotal);
}
function withDisplayedTokenTotal(promptReply, displayedTokenTotal) {
	return {
		...promptReply,
		metrics: {
			...promptReply.metrics,
			tokens: {
				...promptReply.metrics.tokens,
				total: displayedTokenTotal
			}
		}
	};
}
//#endregion
//#region src/bot/handlers/file.handler.ts
var TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
async function handleImageMessage(ctx, dependencies) {
	const image = resolveTelegramImage(ctx.message);
	if (!image) return;
	if (await replyIfSessionRenamePending(ctx, dependencies)) return;
	await executePromptRequest(ctx, dependencies, async () => {
		if (typeof image.fileSize === "number" && image.fileSize > TELEGRAM_MAX_DOWNLOAD_BYTES) throw new ImageMessageUnsupportedError(`Image file size ${image.fileSize} exceeds the Telegram download limit of ${TELEGRAM_MAX_DOWNLOAD_BYTES} bytes.`);
		const filePath = (await ctx.getFile()).file_path?.trim();
		if (!filePath) throw new ImageMessageUnsupportedError("Telegram did not provide a downloadable image file path.");
		return {
			files: [await dependencies.uploadFileUseCase.execute({
				expectedType: "image",
				filePath,
				filename: image.filename,
				mimeType: image.mimeType
			})],
			text: ctx.message.caption?.trim() || null
		};
	});
}
function registerFileHandler(bot, dependencies) {
	bot.on("message:photo", async (ctx) => {
		await handleImageMessage(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
	bot.on("message:document", async (ctx) => {
		await handleImageMessage(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
function resolveTelegramImage(message) {
	const document = message.document;
	if (document && isImageDocument(document)) return {
		fileId: document.file_id,
		fileSize: document.file_size,
		filename: document.file_name ?? null,
		mimeType: document.mime_type ?? null
	};
	const photo = pickLargestPhoto(message.photo);
	if (!photo) return null;
	return {
		fileId: photo.file_id,
		fileSize: photo.file_size,
		filename: null,
		mimeType: "image/jpeg"
	};
}
function isImageDocument(document) {
	const mimeType = document.mime_type?.trim().toLowerCase();
	const filename = document.file_name?.trim().toLowerCase() ?? "";
	return !!mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename);
}
function pickLargestPhoto(photos) {
	if (!photos || photos.length === 0) return null;
	return photos.reduce((largest, current) => {
		return (current.file_size ?? 0) >= (largest.file_size ?? 0) ? current : largest;
	}, photos[0]);
}
//#endregion
//#region src/bot/handlers/message.handler.ts
async function handleTextMessage(ctx, dependencies) {
	const text = ctx.message.text?.trim();
	if (await handlePendingSessionRenameText(ctx, dependencies)) return;
	if (!text) return;
	if (text.startsWith("/")) return;
	if (TODO_TEXT_PATTERN.test(text)) {
		await handleTodoCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
		return;
	}
	await executePromptRequest(ctx, dependencies, async () => ({ text }));
}
function registerMessageHandler(bot, dependencies) {
	bot.on("message:text", async (ctx) => {
		await handleTextMessage(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/handlers/voice.handler.ts
async function handleVoiceMessage(ctx, dependencies) {
	if (!ctx.message.voice) return;
	if (await replyIfSessionRenamePending(ctx, dependencies)) return;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	await ctx.reply(copy.errors.voiceUnsupported);
}
function registerVoiceHandler(bot, dependencies) {
	bot.on("message:voice", async (ctx) => {
		await handleVoiceMessage(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#endregion
//#region src/bot/middlewares/auth.ts
function createAuthMiddleware(allowedChatIds) {
	return async (ctx, next) => {
		if (allowedChatIds.length === 0) return next();
		const chatId = ctx.chat?.id;
		if (!chatId || !allowedChatIds.includes(chatId)) {
			const copy = getBotCopy(normalizeBotLanguage(ctx.from?.language_code));
			await ctx.reply(copy.auth.unauthorizedChat);
			return;
		}
		return next();
	};
}
//#endregion
//#region src/bot/middlewares/logging.ts
function buildIncomingUpdateLogFields(ctx) {
	const messageText = ctx.msg && "text" in ctx.msg ? ctx.msg.text : void 0;
	return {
		...buildTelegramLoggerContext(ctx),
		event: "telegram.update.received",
		updateId: ctx.update.update_id,
		chatId: ctx.chat?.id,
		fromId: ctx.from?.id,
		hasText: typeof messageText === "string" && messageText.length > 0,
		textLength: typeof messageText === "string" ? messageText.length : 0
	};
}
function createLoggingMiddleware(logger) {
	return async (ctx, next) => {
		logTelegramUpdate(logger, { ...buildIncomingUpdateLogFields(ctx) }, "incoming update");
		return next();
	};
}
//#endregion
//#region src/bot/index.ts
function registerBot(bot, container, options) {
	bot.use(createLoggingMiddleware(container.logger));
	bot.use(createAuthMiddleware(options.telegramAllowedChatIds));
	const safeBot = bot.errorBoundary(async (error) => {
		const scopedLogger = scopeLoggerToTelegramContext(container.logger, error.ctx, "telegram");
		scopedLogger.error({
			...extractTelegramUpdateContext(error.ctx),
			event: "telegram.middleware.failed",
			error: error.error
		}, "telegram middleware failed");
		await replyWithDefaultTelegramError(error.ctx, scopedLogger, error.error);
	});
	registerTelegramCommands(safeBot, container);
	registerCallbackHandler(safeBot, container);
	registerFileHandler(safeBot, container);
	registerMessageHandler(safeBot, container);
	registerVoiceHandler(safeBot, container);
}
//#endregion
//#region src/app/runtime.ts
var TELEGRAM_RUNNER_OPTIONS = { runner: {
	fetch: { timeout: 30 },
	maxRetryTime: 900 * 1e3,
	retryInterval: "exponential",
	silent: true
} };
async function startTelegramBotRuntime(input) {
	const runtimeKey = buildTelegramRuntimeKey(input.config);
	const registry = getTelegramBotRuntimeRegistry();
	const existingRuntime = registry.activeByKey.get(runtimeKey);
	const runtimeLogger = input.container.logger.child({ component: "runtime" });
	if (existingRuntime) {
		runtimeLogger.warn({
			event: "runtime.reused",
			runtimeKey,
			telegramApiRoot: input.config.telegramApiRoot
		}, "telegram runtime already active in this process; reusing the existing runner");
		await input.container.dispose();
		return existingRuntime;
	}
	const runtimePromise = startTelegramBotRuntimeInternal(input, runtimeKey, () => {
		if (registry.activeByKey.get(runtimeKey) === runtimePromise) registry.activeByKey.delete(runtimeKey);
	}).catch((error) => {
		if (registry.activeByKey.get(runtimeKey) === runtimePromise) registry.activeByKey.delete(runtimeKey);
		throw error;
	});
	registry.activeByKey.set(runtimeKey, runtimePromise);
	return runtimePromise;
}
async function startTelegramBotRuntimeInternal(input, runtimeKey, releaseRuntime) {
	const bot = (input.botFactory ?? ((token, options) => new Bot(token, options)))(input.config.telegramBotToken, { client: { apiRoot: input.config.telegramApiRoot } });
	const runtimeLogger = input.container.logger.child({ component: "runtime" });
	await verifyTelegramBotAccess(bot, input.config.telegramApiRoot, runtimeKey, runtimeLogger);
	wrapTelegramGetUpdates(bot, input.container);
	(input.registerBotHandlers ?? registerBot)(bot, input.container, { telegramAllowedChatIds: input.config.telegramAllowedChatIds });
	bot.catch((error) => {
		const metadata = extractTelegramUpdateContext(error.ctx);
		const telegramLogger = input.container.logger.child({
			component: "telegram",
			...metadata
		});
		if (error.error instanceof GrammyError) {
			telegramLogger.error({
				event: "telegram.api.error",
				errorCode: error.error.error_code,
				description: error.error.description,
				method: error.error.method,
				parameters: error.error.parameters,
				payload: error.error.payload
			}, "telegram bot api request failed");
			return;
		}
		if (error.error instanceof HttpError) {
			telegramLogger.error({
				event: "telegram.http.error",
				error: error.error.error,
				message: error.error.message
			}, "telegram bot network request failed");
			return;
		}
		telegramLogger.error({
			event: "telegram.update.failed",
			error: error.error
		}, "telegram bot update failed");
	});
	runtimeLogger.info({
		event: "runtime.polling.starting",
		runtimeKey
	}, "telegram bot polling starting");
	const runner = (input.runBot ?? run)(bot, TELEGRAM_RUNNER_OPTIONS);
	let stopped = false;
	let disposed = false;
	if (input.syncCommands ?? true) (input.syncCommandsHandler ?? syncTelegramCommands)(bot, input.container.logger).catch((error) => {
		runtimeLogger.warn({
			event: "runtime.commands.sync_failed",
			error,
			runtimeKey
		}, "failed to sync telegram commands; polling continues without command registration updates");
	});
	let stopPromise = null;
	const requestStop = async () => {
		if (stopped) return;
		stopped = true;
		stopPromise = runner.stop().catch((error) => {
			runtimeLogger.warn({
				event: "runtime.stop.failed",
				error,
				runtimeKey
			}, "failed to stop telegram runner cleanly");
		});
		await stopPromise;
	};
	const stop = () => {
		requestStop();
	};
	const dispose = async () => {
		if (disposed) return;
		disposed = true;
		try {
			await requestStop();
			await input.container.dispose();
		} finally {
			releaseRuntime();
		}
	};
	return {
		bot,
		container: input.container,
		stop,
		dispose
	};
}
function wrapTelegramGetUpdates(bot, container) {
	const originalGetUpdates = bot.api.getUpdates.bind(bot.api);
	const runtimeLogger = container.logger.child({ component: "runtime" });
	bot.api.getUpdates = async (options, signal) => {
		const requestOptions = options ?? {
			limit: 100,
			offset: 0,
			timeout: 30
		};
		try {
			return await originalGetUpdates(requestOptions, signal);
		} catch (error) {
			runtimeLogger.warn({
				event: "runtime.telegram.get_updates_failed",
				error,
				limit: requestOptions.limit,
				offset: requestOptions.offset,
				timeout: requestOptions.timeout
			}, "telegram getUpdates failed");
			throw error;
		}
	};
}
async function verifyTelegramBotAccess(bot, telegramApiRoot, runtimeKey, runtimeLogger) {
	try {
		const botProfile = await validateTelegramBotAccessWithBot(bot, telegramApiRoot);
		runtimeLogger.info({
			event: "runtime.telegram.auth.validated",
			runtimeKey,
			telegramBotId: botProfile.id,
			telegramBotUsername: botProfile.username ?? null
		}, "telegram bot access verified");
	} catch (error) {
		runtimeLogger.error({
			event: "runtime.telegram.auth.failed",
			error,
			runtimeKey,
			telegramApiRoot
		}, "telegram bot startup validation failed");
		throw error;
	}
}
function buildTelegramRuntimeKey(config) {
	return `${config.telegramApiRoot}::${config.telegramBotToken}`;
}
function getTelegramBotRuntimeRegistry() {
	const globalScope = globalThis;
	globalScope.__opencodeTbotTelegramRuntimeRegistry__ ??= { activeByKey: /* @__PURE__ */ new Map() };
	return globalScope.__opencodeTbotTelegramRuntimeRegistry__;
}
//#endregion
//#region src/plugin.ts
async function ensureTelegramBotPluginRuntime(options) {
	const runtimeStateHolder = getTelegramBotPluginRuntimeStateHolder();
	const explicitCwd = resolveExplicitPluginRuntimeCwd(options.context);
	if (runtimeStateHolder.state && explicitCwd === null) return runtimeStateHolder.state.runtimePromise;
	if (runtimeStateHolder.state && explicitCwd !== null && runtimeStateHolder.state.cwd !== explicitCwd) {
		const activeState = runtimeStateHolder.state;
		runtimeStateHolder.state = null;
		await disposeTelegramBotPluginRuntimeState(activeState);
	}
	if (!runtimeStateHolder.state) {
		const runtimePromise = startPluginRuntime(options, resolvePluginRuntimeCwd(options.context), requirePluginClient(options.context)).then((runtime) => {
			if (runtimeStateHolder.state?.runtimePromise === runtimePromise) runtimeStateHolder.state.runtime = runtime;
			return runtime;
		}).catch((error) => {
			if (runtimeStateHolder.state?.runtimePromise === runtimePromise) runtimeStateHolder.state = null;
			throw error;
		});
		runtimeStateHolder.state = {
			cwd: explicitCwd ?? resolvePluginRuntimeCwd(options.context),
			runtime: null,
			runtimePromise
		};
	}
	return runtimeStateHolder.state.runtimePromise;
}
var TelegramBotPlugin = async (context) => {
	try {
		return createHooks(await ensureTelegramBotPluginRuntime({ context }));
	} catch (error) {
		await logPluginStartupFailure(context, error);
		return {};
	}
};
async function resetTelegramBotPluginRuntimeForTests() {
	const runtimeStateHolder = getTelegramBotPluginRuntimeStateHolder();
	if (!runtimeStateHolder.state) return;
	const activeState = runtimeStateHolder.state;
	runtimeStateHolder.state = null;
	await disposeTelegramBotPluginRuntimeState(activeState);
}
async function startPluginRuntime(options, cwd, client) {
	const bootstrapApp = options.bootstrapApp ?? bootstrapPluginApp;
	const prepareConfiguration = options.prepareConfiguration ?? preparePluginConfiguration;
	const startRuntime = options.startRuntime ?? startTelegramBotRuntime;
	const preparedConfiguration = await prepareConfiguration({
		cwd,
		config: options.config
	});
	const { config, container } = bootstrapApp(client, preparedConfiguration.config, {
		cwd: preparedConfiguration.cwd,
		configFilePath: preparedConfiguration.configFilePath
	});
	try {
		const runtime = await startRuntime({
			config,
			container
		});
		container.logger.child({ component: "runtime" }).info({
			cwd: preparedConfiguration.cwd,
			event: "runtime.plugin.started",
			configFilePath: preparedConfiguration.configFilePath,
			mode: "plugin"
		}, "telegram bot plugin runtime started");
		return runtime;
	} catch (error) {
		await container.dispose();
		throw error;
	}
}
function resolvePluginRuntimeCwd(context) {
	return resolveExplicitPluginRuntimeCwd(context) ?? process.cwd();
}
function resolveExplicitPluginRuntimeCwd(context) {
	return normalizePluginRuntimePath(context?.worktree) ?? normalizePluginRuntimePath(context?.directory);
}
function requirePluginClient(context) {
	if (context?.client) return context.client;
	throw new Error("OpenCode plugin context.client is required.");
}
function normalizePluginRuntimePath(value) {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}
async function disposeTelegramBotPluginRuntimeState(state) {
	await (state.runtime ?? await state.runtimePromise.catch(() => null))?.dispose();
}
function createHooks(runtime) {
	return {
		async event({ event }) {
			await handleTelegramBotPluginEvent(runtime, event);
		},
		async "permission.ask"(input, output) {
			const bindings = await runtime.container.sessionRepo.listBySessionId(input.sessionID);
			const foregroundChatIds = runtime.container.foregroundSessionTracker.listChatIds(input.sessionID);
			if (bindings.length > 0 || foregroundChatIds.length > 0) output.status = "ask";
		}
	};
}
function getTelegramBotPluginRuntimeStateHolder() {
	const globalScope = globalThis;
	globalScope.__opencodeTbotPluginRuntimeState__ ??= { state: null };
	return globalScope.__opencodeTbotPluginRuntimeState__;
}
async function logPluginStartupFailure(context, error) {
	const logger = context?.client?.app?.log;
	if (typeof logger !== "function") return;
	try {
		await logger({
			body: {
				service: "opencode-tbot",
				level: "error",
				message: "telegram bot plugin disabled during startup",
				extra: {
					component: "runtime",
					event: "runtime.plugin.disabled",
					mode: "plugin",
					reason: classifyPluginStartupFailureReason(error),
					error: serializePluginStartupError(error)
				}
			},
			responseStyle: "data",
			throwOnError: true
		});
	} catch {}
}
function classifyPluginStartupFailureReason(error) {
	if (error instanceof TelegramStartupError) return error.code;
	if (error instanceof Error && (error.message.includes("Invalid plugin configuration:") || error.message.includes("OpenCode plugin context.client is required.") || error.message.includes("Telegram bot token is required."))) return "config_invalid";
	return "startup_failed";
}
function serializePluginStartupError(error) {
	if (error instanceof TelegramStartupError) return {
		name: error.name,
		message: error.message,
		code: error.code,
		data: error.data
	};
	if (error instanceof Error) return {
		name: error.name,
		message: error.message
	};
	return { message: String(error) };
}
//#endregion
//#region src/bot/todo  
//#region src/bot/todo  
//#region src/bot/todo  [opencode-tbot:todo] BEGIN
var TODO_LIST_ORDER = ["backlog", "in-progress", "done"];
var TODO_FILE_NAMES = {
	"backlog": "backlog.md",
	"in-progress": "in-progress.md",
	"done": "done.md"
};
var TODO_LIST_LABELS = {
	"backlog": "待辦 (Backlog)",
	"in-progress": "進行中 (In Progress)",
	"done": "已完成 (Done)"
};
var TODO_SHORT_LABELS = {
	"backlog": "待辦",
	"in-progress": "進行中",
	"done": "已完成"
};
var TODO_NEXT_STEP = {
	"backlog": "in-progress",
	"in-progress": "done",
	"done": "in-progress"
};
var TODO_STEP_BUTTON = {
	"backlog": "▶",
	"in-progress": "✓",
	"done": "↩"
};
var TODO_DEFAULT_DIRECTORY = "/root/opencode/todo";
var TODO_DEFAULT_COLS = 1;
var TODO_MAX_COLS = 10;
var TODO_MOVE_PREFIX = "todo:move:";
var TODO_TEXT_PATTERN = /^(show|display|list|get|view|see|print|open|顯示|列出|查看|檢視|看)?(?:\s*(me|my|the|我的|目前|我)){0,2}\s*(todo|todolist|todo\s*list|待辦|待办|待辦清單|待办清单|工作清單|工作清单)\s*(list|清單)?\s*[.!?]?\s*$/i;
var TODO_ITEM_PATTERN = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/u;
var TODO_DATE_SUFFIX_PATTERN = /[（(]\d{4}-\d{2}-\d{2}[）)]\s*$/u;
async function resolveTodoDirectory() {
	try {
		const configFile = await loadPluginConfigFile(getGlobalPluginConfigFilePath());
		const configured = configFile?.todo?.directory;
		if (typeof configured === "string" && configured.trim().length > 0) return configured.trim();
	} catch {}
	return TODO_DEFAULT_DIRECTORY;
}
async function resolveTodoCols() {
	try {
		const configFile = await loadPluginConfigFile(getGlobalPluginConfigFilePath());
		const configured = configFile?.todo?.cols;
		if (typeof configured === "number" && Number.isInteger(configured) && configured >= 1 && configured <= TODO_MAX_COLS) return configured;
	} catch {}
	return TODO_DEFAULT_COLS;
}
async function setTodoCols(cols) {
	const configFilePath = getGlobalPluginConfigFilePath();
	const currentConfig = await loadPluginConfigFile(configFilePath);
	const nextConfig = mergePluginConfigSources(currentConfig, { todo: { ...(currentConfig.todo && typeof currentConfig.todo === "object" ? currentConfig.todo : {}), cols } });
	await writePluginConfigFile(configFilePath, nextConfig);
}
async function readTodoFiles(directory) {
	const state = {};
	for (const list of TODO_LIST_ORDER) {
		const filePath = join(directory, TODO_FILE_NAMES[list]);
		let lines = [];
		try {
			lines = (await readFile(filePath, "utf8")).split(/\r?\n/u);
		} catch (error) {
			if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
		}
		const items = [];
		lines.forEach((line, index) => {
			const match = line.match(TODO_ITEM_PATTERN);
			if (match) items.push({ index, line, text: match[2], checked: match[1].toLowerCase() === "x" });
		});
		state[list] = { lines, items };
	}
	return state;
}
async function writeTodoFile(directory, list, lines) {
	await writeFile(join(directory, TODO_FILE_NAMES[list]), `${lines.join("\n")}\n`, "utf8");
}
async function moveTodoItem(directory, from, index, to) {
	const state = await readTodoFiles(directory);
	const source = state[from];
	const target = state[to];
	const item = source.items[index];
	if (!item) throw new Error(`todo item #${index} not found in ${from}`);
	const checked = to === "done" ? "x" : " ";
	let text = item.text.trim();
	if (to === "done" && !TODO_DATE_SUFFIX_PATTERN.test(text)) {
		const now = new Date();
		const month = String(now.getMonth() + 1).padStart(2, "0");
		const day = String(now.getDate()).padStart(2, "0");
		text = `${text} — ${now.getFullYear()}-${month}-${day}`;
	}
	source.lines.splice(item.index, 1);
	target.lines.push(`- [${checked}] ${text}`);
	await writeTodoFile(directory, from, source.lines);
	await writeTodoFile(directory, to, target.lines);
}
function buildTodoMessage(state) {
	const lines = ["📋 待辦清單"];
	const MAX_LENGTH = 4000;
	for (const list of TODO_LIST_ORDER) {
		const items = state[list].items;
		lines.push("", `— ${TODO_LIST_LABELS[list]} —`);
		if (items.length === 0) {
			lines.push("（無）");
			continue;
		}
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			lines.push(`${index + 1}. ${item.checked ? "✅" : "⬜"} ${item.text}`);
			const current = lines.join("\n");
			if (current.length > MAX_LENGTH) {
				lines.pop();
				lines.push(`... (截斷，共 ${items.length} 項，請用 /todo_done 查看完整完成項目)`);
				return lines.join("\n");
			}
		}
	}
	lines.push("", "點下方按鈕切換事項狀態");
	return lines.join("\n");
}
function buildTodoMessageActive(state) {
	const lines = ["📋 待辦清單"];
	for (const list of ["in-progress", "backlog"]) {
		const items = state[list].items;
		lines.push("", `— ${TODO_LIST_LABELS[list]} —`);
		if (items.length === 0) {
			lines.push("（無）");
			continue;
		}
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			lines.push(`${index + 1}. ${item.checked ? "✅" : "⬜"} ${item.text}`);
		}
	}
	lines.push("", "✅ 已完成項目請用 /todo_done 查看");
	lines.push("", "點下方按鈕切換事項狀態");
	return lines.join("\n");
}
function truncateTodoButtonText(text, maxBytes) {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes <= maxBytes) return text;
	let out = "";
	let size = 0;
	for (const ch of text) {
		const chBytes = new TextEncoder().encode(ch).length;
		if (size + chBytes > maxBytes - 1) break;
		out += ch;
		size += chBytes;
	}
	return `${out}…`;
}
async function buildTodoKeyboard(state) {
	const cols = await resolveTodoCols();
	const keyboard = new InlineKeyboard();
	let targetWidth = 0;
	const pending = [];
	for (const list of TODO_LIST_ORDER) {
		const items = state[list].items;
		if (items.length === 0) continue;
		const sectionButtons = items.map((item, index) => {
			const target = TODO_NEXT_STEP[list];
			const mark = item.checked ? "✅" : "⬜";
			return {
				label: `${mark} ${truncateTodoButtonText(item.text, 40)}`,
				data: `todo:move:${list}:${index}:${target}`
			};
		});
		targetWidth = Math.max(targetWidth, todoLabelWidth(TODO_LIST_LABELS[list]), ...sectionButtons.map((button) => todoLabelWidth(button.label)));
		pending.push({ list, sectionButtons });
	}
	targetWidth = Math.min(targetWidth, 44);
	for (const { list, sectionButtons } of pending) {
		keyboard.text(alignTodoButtonText(TODO_LIST_LABELS[list], targetWidth), `todo:list:${list}`);
		keyboard.row();
		for (let index = 0; index < sectionButtons.length; index += 1) {
			const button = sectionButtons[index];
			keyboard.text(alignTodoButtonText(button.label, targetWidth), button.data);
			if ((index + 1) % cols === 0 || index === sectionButtons.length - 1) keyboard.row();
		}
	}
	keyboard.text(alignTodoButtonText("🔄 重新整理", targetWidth), "todo:refresh");
	return keyboard;
}
async function buildTodoDoneKeyboard(state) {
	const cols = await resolveTodoCols();
	const keyboard = new InlineKeyboard();
	const doneItems = state["done"].items;
	const MAX_DONE_BUTTONS = 20;
	let targetWidth = 0;
	if (doneItems.length === 0) {
		keyboard.text("（無）", "noop");
	} else {
		for (const item of doneItems) {
			targetWidth = Math.max(targetWidth, todoLabelWidth(item.text));
		}
		targetWidth = Math.min(targetWidth, 44);
		for (let i = 0; i < Math.min(doneItems.length, MAX_DONE_BUTTONS); i++) {
			const item = doneItems[i];
			keyboard.text(alignTodoButtonText(item.text, targetWidth), `todo:done:${item.index}`);
			keyboard.row();
		}
		if (doneItems.length > MAX_DONE_BUTTONS) {
			keyboard.text(`... 共 ${doneItems.length} 項 (顯示前 ${MAX_DONE_BUTTONS} 項)`, "noop");
			keyboard.row();
		}
	}
	if (targetWidth === 0) targetWidth = 10;
	keyboard.text(alignTodoButtonText("⬅️ 返回 /todo", targetWidth), "todo:back2main");
	keyboard.text(alignTodoButtonText("🔄 重新整理", targetWidth), "todo:refresh");
	return keyboard;
}
var TODO_ZWJ = "\u200d";
function alignTodoButtonText(text, targetWidth) {
	const padding = Math.max(0, targetWidth - todoLabelWidth(text));
	if (padding === 0) return text;
	return `${text}${" \u200d".repeat(padding)}`;
}
function todoLabelWidth(value) {
	let width = 0;
	for (const char of value) width += isTodoWideCharacter(char.codePointAt(0) ?? 0) ? 2 : 1;
	return width;
}
function isTodoWideCharacter(codePoint) {
	return codePoint >= 4352 && (codePoint <= 4447 || codePoint === 9001 || codePoint === 9002 || codePoint >= 11904 && codePoint <= 42191 && codePoint !== 12351 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65040 && codePoint <= 65049 || codePoint >= 65072 && codePoint <= 65135 || codePoint >= 65280 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510);
}
async function handleTodoCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const directory = await resolveTodoDirectory();
		const state = await readTodoFiles(directory);
		await ctx.reply(buildTodoMessageActive(state), { reply_markup: await buildTodoKeyboard(state) });
	} catch (error) {
		dependencies.logger.error({ error }, "failed to show todo list");
		await ctx.reply(presentError(error, copy));
	}
}
async function handleTodoDoneCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const directory = await resolveTodoDirectory();
		const state = await readTodoFiles(directory);
		const msg = buildTodoMessage(state);
		const kb = await buildTodoDoneKeyboard(state);
		dependencies.logger.info({ msgLen: msg.length, kbType: typeof kb }, "todo_done: sending reply");
		await ctx.reply(msg, { reply_markup: kb });
		dependencies.logger.info("todo_done: reply sent");
	} catch (error) {
		dependencies.logger.error({ error, stack: error?.stack }, "failed to show done list");
		await ctx.reply(presentError(error, copy));
	}
}
function registerTodoCommand(bot, dependencies) {
	bot.command("todo", async (ctx) => {
		await handleTodoCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
function registerTodoDoneCommand(bot, dependencies) {
	bot.command("todo_done", async (ctx) => {
		await handleTodoDoneCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var TODO_DONE_COMMAND_DEFINITION = {
	describe() {
		return "Show completed todo items";
	},
	names: ["todo_done"],
	register: registerTodoDoneCommand
};
var TODO_COMMAND_DEFINITION = {
	describe() {
		return "Show and manage the todo list";
	},
	names: ["todo"],
	register: registerTodoCommand
};
async function handleSetTodoColsCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const raw = String(ctx.match ?? "").trim();
		const cols = Number(raw);
		const current = await resolveTodoCols();
		if (!/^\d+$/u.test(raw) || !Number.isInteger(cols) || cols < 1 || cols > TODO_MAX_COLS) {
			await ctx.reply(`❌ 無效欄數：請使用 \`/settodo_cols <1-${TODO_MAX_COLS}>\`（目前 ${current} 欄）`);
			return;
		}
		await setTodoCols(cols);
		await ctx.reply(`✅ 已將待辦按鈕欄數設為 ${cols} 欄`);
	} catch (error) {
		dependencies.logger.error({ error }, "failed to set todo cols");
		await ctx.reply(presentError(error, copy));
	}
}
function registerSetTodoColsCommand(bot, dependencies) {
	bot.command("settodo_cols", async (ctx) => {
		await handleSetTodoColsCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
var SETTODO_COLS_COMMAND_DEFINITION = {
	describe() {
		return "Set the number of columns per row for todo buttons";
	},
	names: ["settodo_cols"],
	register: registerSetTodoColsCommand
};
async function safeEditMessageText(ctx, text, options) {
	try {
		await ctx.editMessageText(text, options);
	} catch (error) {
		if (error?.description?.includes("message is not modified")) {
			return;
		}
		throw error;
	}
}
async function handleTodoCallback(ctx, dependencies) {
	const data = ctx.callbackQuery.data;
	if (!data.startsWith("todo:")) return;
	await ctx.answerCallbackQuery();
	if (!ctx.chat) return;
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	try {
		const directory = await resolveTodoDirectory();
		const state = await readTodoFiles(directory);
		if (data === "todo:refresh") {
			await safeEditMessageText(ctx, buildTodoMessage(state), { reply_markup: await buildTodoKeyboard(state) });
			return;
		}
		if (data === "todo:back2main") {
			await safeEditMessageText(ctx, buildTodoMessageActive(state), { reply_markup: await buildTodoKeyboard(state) });
			return;
		}
		if (data.startsWith(TODO_MOVE_PREFIX)) {
			const parts = data.slice(TODO_MOVE_PREFIX.length).split(":");
			if (parts.length !== 3) return;
			const [from, index, to] = parts;
			if (!TODO_LIST_ORDER.includes(from) || !TODO_LIST_ORDER.includes(to) || !/^\d+$/u.test(index)) return;
			await moveTodoItem(directory, from, Number(index), to);
			await safeEditMessageText(ctx, buildTodoMessage(state), { reply_markup: await buildTodoKeyboard(state) });
			return;
		}
		if (data === "todo:done") {
			await safeEditMessageText(ctx, buildTodoMessage(state), { reply_markup: await buildTodoDoneKeyboard(state) });
			return;
		}
	} catch (error) {
		dependencies.logger.error({ error, callbackData: data }, "failed to handle todo callback");
		await ctx.editMessageText(presentError(error, copy));
	}
}
function registerTodoCallbackRoute(bot, dependencies) {
	bot.callbackQuery(/^todo:/, async (ctx) => {
		await handleTodoCallback(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}
//#region [opencode-tbot:mailsearch] START
async function handleMailSearchCommand(ctx, dependencies) {
	const copy = await getSafeChatCopy(dependencies.sessionRepo, ctx.chat.id, dependencies.logger);
	const args = (ctx.match ?? "").trim();
	
	try {
		const { spawnSync } = await import("node:child_process");
		const scriptPath = "/root/.config/opencode/mail-agent/mail_search.py";
		const cmdArgs = ["python3", scriptPath];
		
		if (args) {
			cmdArgs.push(...args.split(/\s+/));
		} else {
			cmdArgs.push("--limit", "20");
		}
		
		const result = spawnSync(cmdArgs[0], cmdArgs.slice(1), {
			encoding: "utf-8",
			timeout: 30000,
		});
		
		if (result.error) {
			await ctx.reply(`❌ 搜尋失敗: ${result.error.message}`);
			return;
		}
		
		const output = (result.stdout || "").trim();
		const stderr = (result.stderr || "").trim();
		
		if (!output && !stderr) {
			await ctx.reply("📭 沒有找到符合的郵件處理記錄。");
			return;
		}
		
		if (stderr) {
			await ctx.reply(`⚠️ 警告: ${stderr}`);
		}
		
		// Split long output into multiple messages (Telegram limit ~4096 chars)
		const maxLen = 4000;
		if (output.length <= maxLen) {
			await ctx.reply(`🔍 郵件搜尋結果:\n\n${output}`);
		} else {
			const chunks = [];
			for (let i = 0; i < output.length; i += maxLen) {
				chunks.push(output.slice(i, i + maxLen));
			}
			for (let i = 0; i < chunks.length; i++) {
				const prefix = i === 0 ? "🔍 郵件搜尋結果" : `🔍 (續 ${i + 1}/${chunks.length})`;
				await ctx.reply(`${prefix}:\n\n${chunks[i]}`);
			}
		}
	} catch (error) {
		dependencies.logger.error({ error }, "failed to execute mail search");
		await ctx.reply(presentError(error, copy));
	}
}

function registerMailSearchCommand(bot, dependencies) {
	bot.command("mailsearch", async (ctx) => {
		await handleMailSearchCommand(ctx, scopeDependenciesToTelegramContext(dependencies, ctx, "telegram"));
	});
}

var MAILSEARCH_COMMAND_DEFINITION = {
	describe() {
		return "Search mail processing history (usage: /mailsearch [sender] [--since YYYY-MM-DD] [--action TYPE] [keyword...])";
	},
	names: ["mailsearch"],
	register: registerMailSearchCommand
};
//#endregion [opencode-tbot:mailsearch] END
export { TelegramBotPlugin, TelegramBotPlugin as default, ensureTelegramBotPluginRuntime, resetTelegramBotPluginRuntimeForTests };

//# sourceMappingURL=plugin.js.map