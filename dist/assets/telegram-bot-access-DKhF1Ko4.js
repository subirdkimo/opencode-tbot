import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Bot, GrammyError, HttpError } from "grammy";
//#region src/app/opencode-paths.ts
var GLOBAL_PLUGIN_DIRECTORY_NAME = "opencode-tbot";
var GLOBAL_PLUGIN_CONFIG_FILE_NAME = "config.json";
var GLOBAL_OPENCODE_CONFIG_FILE_NAME = "opencode.json";
function getOpenCodeConfigDirectory(homeDir = homedir()) {
	return join(homeDir, ".config", "opencode");
}
function getGlobalPluginConfigFilePath(homeDir = homedir()) {
	return join(getOpenCodeConfigDirectory(homeDir), GLOBAL_PLUGIN_DIRECTORY_NAME, GLOBAL_PLUGIN_CONFIG_FILE_NAME);
}
function getGlobalOpenCodeConfigFilePath(homeDir = homedir()) {
	return join(getOpenCodeConfigDirectory(homeDir), GLOBAL_OPENCODE_CONFIG_FILE_NAME);
}
function getOpenCodeLogDirectory(homeDir = homedir()) {
	return join(homeDir, ".local", "share", "opencode", "log");
}
function getDefaultPluginLogDirectory(homeDir = homedir()) {
	return join(getOpenCodeLogDirectory(homeDir), "plugins", "opencode-tbot");
}
//#endregion
//#region src/domain/token/token-settings.entity.ts
function calculateDisplayedTokenTotal(values) {
	const metrics = [
		values.input,
		values.output,
		values.reasoning,
		values.cacheRead,
		values.cacheWrite
	];
	if (metrics.every((value) => value === null)) return null;
	const total = metrics.reduce((sum, value) => sum + (value ?? 0), 0);
	return Number.isFinite(total) ? total : null;
}
//#endregion
//#region src/app/config.ts
var DEFAULT_STATE_FILE_PATH = "./data/opencode-tbot.state.json";
var DEFAULT_TELEGRAM_API_ROOT = "https://api.telegram.org";
var DEFAULT_PROMPT_WAIT_TIMEOUT_MS = 18e5;
var DEFAULT_PROMPT_POLL_REQUEST_TIMEOUT_MS = 15e3;
var DEFAULT_PROMPT_RECOVERY_INACTIVITY_TIMEOUT_MS = 12e4;
var DEFAULT_LOG_LEVEL = "info";
var DEFAULT_LOG_RETENTION_MAX_TOTAL_BYTES = 314572800;
var AllowedChatIdSchema = z.union([z.number().int(), z.string().regex(/^-?\d+$/u).transform((value) => Number(value))]);
var TelegramConfigSchema = z.preprocess((value) => value ?? {}, z.object({
	botToken: z.string().trim().min(1),
	allowedChatIds: z.array(AllowedChatIdSchema).default([]),
	apiRoot: z.string().trim().url().default(DEFAULT_TELEGRAM_API_ROOT)
}));
var StateConfigSchema = z.preprocess((value) => value ?? {}, z.object({ path: z.string().trim().min(1).default(DEFAULT_STATE_FILE_PATH) }));
var PromptConfigSchema = z.preprocess((value) => value ?? {}, z.object({
	waitTimeoutMs: z.number().int().positive().default(DEFAULT_PROMPT_WAIT_TIMEOUT_MS),
	pollRequestTimeoutMs: z.number().int().positive().default(DEFAULT_PROMPT_POLL_REQUEST_TIMEOUT_MS),
	recoveryInactivityTimeoutMs: z.number().int().positive().default(DEFAULT_PROMPT_RECOVERY_INACTIVITY_TIMEOUT_MS)
}));
var LoggingConfigSchema = z.preprocess((value) => value ?? {}, z.object({
	level: z.string().trim().min(1).optional(),
	sinks: z.preprocess((value) => value ?? {}, z.object({
		host: z.boolean().default(true),
		file: z.boolean().default(true)
	})),
	file: z.preprocess((value) => value ?? {}, z.object({
		dir: z.string().trim().min(1).optional(),
		retention: z.preprocess((value) => value ?? {}, z.object({
			maxFiles: z.number().int().positive().default(30),
			maxTotalBytes: z.number().int().positive().default(DEFAULT_LOG_RETENTION_MAX_TOTAL_BYTES)
		}))
	}))
}));
var TokenConfigSchema = z.preprocess((value) => value ?? {}, z.object({ showBreakdown: z.boolean().default(false) }));
var AppConfigSchema = z.object({
	telegram: TelegramConfigSchema,
	state: StateConfigSchema,
	prompt: PromptConfigSchema,
	tokens: TokenConfigSchema.default({}),
	logging: LoggingConfigSchema.default({})
});
function loadAppConfig(configSource = {}, options = {}) {
	return buildAppConfig(parseConfig(AppConfigSchema, configSource), options);
}
function buildAppConfig(data, options) {
	const cwd = options.cwd ?? process.cwd();
	const loggingLevel = normalizeLogLevelValue(data.logging.level);
	return {
		telegramBotToken: data.telegram.botToken,
		telegramAllowedChatIds: data.telegram.allowedChatIds,
		telegramApiRoot: normalizeApiRoot(data.telegram.apiRoot),
		loggingLevel,
		loggingHostSinkEnabled: data.logging.sinks.host,
		loggingFileSinkEnabled: data.logging.sinks.file,
		loggingFileDir: resolveLoggingDirectory(data.logging.file.dir, cwd),
		loggingRetentionMaxFiles: data.logging.file.retention.maxFiles,
		loggingRetentionMaxTotalBytes: data.logging.file.retention.maxTotalBytes,
		promptWaitTimeoutMs: data.prompt.waitTimeoutMs,
		promptPollRequestTimeoutMs: data.prompt.pollRequestTimeoutMs,
		promptRecoveryInactivityTimeoutMs: data.prompt.recoveryInactivityTimeoutMs,
		tokenShowBreakdown: data.tokens.showBreakdown,
		pluginConfigFilePath: options.configFilePath ?? getGlobalPluginConfigFilePath(homedir()),
		stateFilePath: resolveStatePath(data, cwd),
		worktreePath: cwd
	};
}
function resolveStatePath(data, cwd) {
	return resolve(cwd, data.state.path || "./data/opencode-tbot.state.json");
}
function normalizeApiRoot(value) {
	const normalized = value.trim();
	return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
function normalizeLogLevelValue(value) {
	const normalized = value?.trim().toLowerCase();
	switch (normalized) {
		case "debug":
		case "warn":
		case "error":
		case "info": return normalized;
		default: return DEFAULT_LOG_LEVEL;
	}
}
function resolveLoggingDirectory(value, cwd) {
	const normalized = value?.trim();
	if (!normalized) return getDefaultPluginLogDirectory(homedir());
	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}
function parseConfig(schema, configSource) {
	const parsed = schema.safeParse(configSource ?? {});
	if (parsed.success) return parsed.data;
	throw new Error(`Invalid plugin configuration: ${JSON.stringify(parsed.error.flatten())}`);
}
//#endregion
//#region src/app/package-info.ts
var OPENCODE_TBOT_VERSION = resolvePackageVersion();
function resolvePackageVersion() {
	let directory = dirname(fileURLToPath(import.meta.url));
	while (true) {
		const packageFilePath = join(directory, "package.json");
		if (existsSync(packageFilePath)) try {
			const parsed = JSON.parse(readFileSync(packageFilePath, "utf8"));
			if (typeof parsed.version === "string" && parsed.version.trim().length > 0) return parsed.version;
		} catch {}
		const parentDirectory = dirname(directory);
		if (parentDirectory === directory) break;
		directory = parentDirectory;
	}
	return "unknown";
}
//#endregion
//#region src/infra/utils/utf8.ts
function stripUtf8ByteOrderMark(input) {
	return input.charCodeAt(0) === 65279 ? input.slice(1) : input;
}
//#endregion
//#region src/app/plugin-config.ts
var PLUGIN_CONFIG_SECTION_KEYS = [
	"telegram",
	"state",
	"prompt",
	"tokens",
	"logging"
];
var PLUGIN_CONFIG_SECTION_MERGERS = {
	telegram: mergeObjectSection,
	state: mergeObjectSection,
	prompt: mergeObjectSection,
	tokens: mergeObjectSection,
	logging: mergeLoggingConfig
};
async function preparePluginConfiguration(options) {
	const configFilePath = getGlobalPluginConfigFilePath(options.homeDir ?? homedir());
	const config = mergePluginConfigSources(await loadPluginConfigFile(configFilePath), options.config);
	return {
		cwd: options.cwd,
		config,
		configFilePath
	};
}
async function writePluginConfigFile(configFilePath, config) {
	await mkdir(dirname(configFilePath), { recursive: true });
	await writeFile(configFilePath, serializePluginConfig(config), "utf8");
}
function mergePluginConfigSources(...sources) {
	const merged = {};
	for (const source of sources) {
		if (!source) continue;
		const previousSections = {
			telegram: merged.telegram,
			state: merged.state,
			prompt: merged.prompt,
			tokens: merged.tokens,
			logging: merged.logging
		};
		Object.assign(merged, source);
		for (const key of PLUGIN_CONFIG_SECTION_KEYS) {
			const nextSection = source[key];
			if (!nextSection) continue;
			merged[key] = PLUGIN_CONFIG_SECTION_MERGERS[key](previousSections[key], nextSection);
		}
	}
	return merged;
}
function serializePluginConfig(config) {
	return `${JSON.stringify(orderPluginConfig(config), null, 2)}\n`;
}
async function loadPluginConfigFile(configFilePath) {
	try {
		return parsePluginConfigText(await readFile(configFilePath, "utf8"), configFilePath);
	} catch (error) {
		if (isMissingFileError(error)) return {};
		throw error;
	}
}
function parsePluginConfigText(content, configFilePath) {
	try {
		const parsed = JSON.parse(stripUtf8ByteOrderMark(content));
		if (!isPlainObject(parsed)) throw new Error("Config root must be a JSON object.");
		return parsed;
	} catch (error) {
		throw new Error([`Failed to parse ${configFilePath} as JSON.`, error instanceof Error ? error.message : String(error)].join(" "));
	}
}
function orderPluginConfig(config) {
	const prioritizedKeys = new Set([
		"telegram",
		"state",
		"prompt",
		"tokens",
		"logging"
	]);
	const ordered = {};
	if (config.telegram) ordered.telegram = config.telegram;
	if (config.state) ordered.state = config.state;
	if (config.prompt) ordered.prompt = config.prompt;
	if (config.tokens) ordered.tokens = config.tokens;
	if (config.logging) ordered.logging = config.logging;
	for (const [key, value] of Object.entries(config)) if (!prioritizedKeys.has(key)) ordered[key] = value;
	return ordered;
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isMissingFileError(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function mergeObjectSection(previous, next) {
	return {
		...previous ?? {},
		...next
	};
}
function mergeLoggingConfig(previous, next) {
	const merged = mergeObjectSection(previous ?? {}, next);
	const mergedSinks = next.sinks || previous?.sinks ? mergeObjectSection(previous?.sinks ?? {}, next.sinks ?? {}) : void 0;
	const mergedRetention = next.file?.retention || previous?.file?.retention ? mergeObjectSection(previous?.file?.retention ?? {}, next.file?.retention ?? {}) : void 0;
	const mergedFile = next.file || previous?.file ? {
		...mergeObjectSection(previous?.file ?? {}, next.file ?? {}),
		...mergedRetention ? { retention: mergedRetention } : {}
	} : void 0;
	return {
		...merged,
		...mergedSinks ? { sinks: mergedSinks } : {},
		...mergedFile ? { file: mergedFile } : {}
	};
}
//#endregion
//#region src/services/telegram/telegram-bot-access.ts
var TelegramStartupError = class extends Error {
	code;
	data;
	constructor(code, message, data) {
		super(message);
		this.name = "TelegramStartupError";
		this.code = code;
		this.data = data;
	}
};
var TELEGRAM_BOT_TOKEN_PATTERN = /^\d{6,}:[A-Za-z0-9_-]{20,}$/u;
function normalizeTelegramBotToken(value) {
	const normalized = value.trim();
	if (normalized.length === 0) throw new Error("Telegram bot token is required.");
	if (!TELEGRAM_BOT_TOKEN_PATTERN.test(normalized)) throw new TelegramStartupError("invalid_token", "Telegram bot token format is invalid. Expected '<bot-id>:<secret>'.", { apiRoot: "" });
	return normalized;
}
function normalizeTelegramApiRoot(value) {
	const normalized = value.trim();
	if (normalized.length === 0) throw new Error("Telegram API root is required.");
	try {
		return new URL(normalized).toString().replace(/\/+$/u, "");
	} catch {
		throw new Error("Telegram API root must be a valid URL.");
	}
}
async function validateTelegramBotAccess(input) {
	const botToken = normalizeTelegramBotToken(input.botToken);
	const apiRoot = normalizeTelegramApiRoot(input.apiRoot);
	return {
		apiRoot,
		botProfile: await validateTelegramBotAccessWithBot((input.botFactory ?? ((token, options) => new Bot(token, options)))(botToken, { client: { apiRoot } }), apiRoot),
		botToken
	};
}
async function validateTelegramBotAccessWithBot(bot, apiRoot) {
	const normalizedApiRoot = normalizeTelegramApiRoot(apiRoot);
	try {
		const botProfile = await bot.api.getMe();
		return {
			id: botProfile.id,
			username: botProfile.username ?? null
		};
	} catch (error) {
		throw createTelegramStartupError(error, normalizedApiRoot);
	}
}
function createTelegramStartupError(error, apiRoot) {
	if (error instanceof TelegramStartupError) return error;
	if (error instanceof GrammyError) {
		if (error.error_code === 401 || error.error_code === 403) return new TelegramStartupError("invalid_token", `Telegram bot token is invalid or revoked (${error.description}).`, { apiRoot });
		return new TelegramStartupError("telegram_api_rejected", `Telegram Bot API rejected startup validation via '${error.method}' (${error.error_code}: ${error.description}).`, { apiRoot });
	}
	if (error instanceof HttpError) return new TelegramStartupError("telegram_api_unreachable", `Unable to reach the Telegram Bot API at ${apiRoot}.${error.error instanceof Error && error.error.message.trim().length > 0 ? ` ${error.error.message.trim()}` : ""}`, { apiRoot });
	return error instanceof Error ? error : new Error(String(error));
}
//#endregion
export { mergePluginConfigSources as a, stripUtf8ByteOrderMark as c, loadAppConfig as d, calculateDisplayedTokenTotal as f, getOpenCodeConfigDirectory as h, loadPluginConfigFile as i, OPENCODE_TBOT_VERSION as l, getGlobalPluginConfigFilePath as m, validateTelegramBotAccess as n, preparePluginConfiguration as o, getGlobalOpenCodeConfigFilePath as p, validateTelegramBotAccessWithBot as r, writePluginConfigFile as s, TelegramStartupError as t, DEFAULT_TELEGRAM_API_ROOT as u };

//# sourceMappingURL=telegram-bot-access-DKhF1Ko4.js.map