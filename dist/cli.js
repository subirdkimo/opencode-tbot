import { a as mergePluginConfigSources, c as stripUtf8ByteOrderMark, h as getOpenCodeConfigDirectory, l as OPENCODE_TBOT_VERSION, m as getGlobalPluginConfigFilePath, n as validateTelegramBotAccess, p as getGlobalOpenCodeConfigFilePath, s as writePluginConfigFile } from "./assets/telegram-bot-access-DKhF1Ko4.js";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
//#region src/cli.ts
var PROMPT_CANCELLED_ERROR = "Prompt cancelled.";
var OPENCODE_CONFIG_SCHEMA_URL = "https://opencode.ai/config.json";
var OPENCODE_TBOT_PACKAGE_NAME = "opencode-tbot";
var CONFLICTING_LOCAL_PLUGIN_FILE_PATTERN = /^opencode-tbot\.(?:[cm]?[jt]s)$/u;
async function main(argv = process.argv.slice(2)) {
	try {
		const exitCode = await runCli(argv);
		process.exitCode = exitCode;
		return exitCode;
	} catch (error) {
		stderr.write(`${formatCliError(error)}\n`);
		process.exitCode = 1;
		return 1;
	}
}
async function runCli(argv) {
	const options = parseCliOptions(argv);
	if (options.command === "help") {
		stdout.write(`${buildHelpText()}\n`);
		return 0;
	}
	if (options.command === "version") {
		stdout.write(`${OPENCODE_TBOT_VERSION}\n`);
		return 0;
	}
	if (options.command === "update") {
		await updatePlugin(options);
		return 0;
	}
	if (options.command === "uninstall") {
		await uninstallPlugin(options);
		return 0;
	}
	await installPlugin(options);
	return 0;
}
async function installPlugin(options = {}) {
	const homeDir = options.homeDir ?? homedir();
	await assertNoConflictingLocalPluginFiles(homeDir);
	const openCodeConfigFilePath = getGlobalOpenCodeConfigFilePath(homeDir);
	const globalPluginConfigFilePath = getGlobalPluginConfigFilePath(homeDir);
	const existingPluginConfig = await readPluginConfigFile(globalPluginConfigFilePath);
	const existingOpenCodeConfig = await readOpenCodeConfigFile(openCodeConfigFilePath);
	const prompt = createPromptSession();
	try {
		const botToken = normalizeRequiredString(options.botToken ?? await prompt.askSecret("Telegram bot token: "), "Telegram bot token is required.");
		const validatedAccess = await validateTelegramBotAccess({
			apiRoot: normalizeOptionalString(options.telegramApiRoot) ?? "https://api.telegram.org",
			botToken
		});
		const nextOpenCodeConfig = buildInstalledOpenCodeConfig(existingOpenCodeConfig);
		const nextPluginConfig = buildInstalledPluginConfig(existingPluginConfig, validatedAccess.botToken, validatedAccess.apiRoot);
		await writeOpenCodeConfigFile(openCodeConfigFilePath, nextOpenCodeConfig);
		await writePluginConfigFile(globalPluginConfigFilePath, nextPluginConfig);
		stdout.write("Success.\n");
	} finally {
		prompt.close();
	}
}
async function updatePlugin(options = {}) {
	const homeDir = options.homeDir ?? homedir();
	await assertNoConflictingLocalPluginFiles(homeDir);
	const openCodeConfigFilePath = getGlobalOpenCodeConfigFilePath(homeDir);
	await writeOpenCodeConfigFile(openCodeConfigFilePath, buildInstalledOpenCodeConfig(await readOpenCodeConfigFile(openCodeConfigFilePath)));
	stdout.write("Success.\n");
}
async function uninstallPlugin(options = {}) {
	const openCodeConfigFilePath = getGlobalOpenCodeConfigFilePath(options.homeDir ?? homedir());
	const existingOpenCodeConfig = await readOpenCodeConfigFileIfPresent(openCodeConfigFilePath);
	if (existingOpenCodeConfig) await writeOpenCodeConfigFile(openCodeConfigFilePath, buildUninstalledOpenCodeConfig(existingOpenCodeConfig));
	stdout.write("Success.\n");
}
function parseCliOptions(argv) {
	const args = [...argv];
	const first = args[0];
	const command = !first || first.startsWith("-") ? "install" : first;
	const values = command === "install" || command === "version" ? args : args.slice(1);
	const options = { command: command === "help" || command === "--help" || command === "-h" ? "help" : command === "version" || command === "--version" || command === "-v" ? "version" : command === "uninstall" ? "uninstall" : command === "update" ? "update" : "install" };
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index];
		if (index === 0 && !value.startsWith("-")) continue;
		switch (value) {
			case "--bot-token":
				options.botToken = values[++index];
				break;
			case "--telegram-api-root":
				options.telegramApiRoot = values[++index];
				break;
			case "--home-dir":
				options.homeDir = values[++index];
				break;
			case "--help":
			case "-h":
				options.command = "help";
				break;
			case "--version":
			case "-v":
				options.command = "version";
				break;
			default: throw new Error(`Unknown argument: ${value}`);
		}
	}
	return options;
}
function buildInstalledPluginConfig(current, botToken, telegramApiRoot) {
	return mergePluginConfigSources(current, { telegram: {
		botToken,
		apiRoot: telegramApiRoot
	} });
}
async function readPluginConfigFile(configFilePath) {
	try {
		const content = await readFile(configFilePath, "utf8");
		const parsed = JSON.parse(stripUtf8ByteOrderMark(content));
		return isPlainObject(parsed) ? parsed : {};
	} catch (error) {
		if (isMissingFileError(error)) return {};
		throw error;
	}
}
async function ensureParentDirectory(filePath) {
	await mkdir(dirname(filePath), { recursive: true });
}
async function readOpenCodeConfigFile(configFilePath) {
	try {
		const content = await readFile(configFilePath, "utf8");
		const parsed = JSON.parse(stripUtf8ByteOrderMark(content));
		return isPlainObject(parsed) ? parsed : {};
	} catch (error) {
		if (isMissingFileError(error)) return {};
		throw error;
	}
}
async function readOpenCodeConfigFileIfPresent(configFilePath) {
	try {
		const content = await readFile(configFilePath, "utf8");
		const parsed = JSON.parse(stripUtf8ByteOrderMark(content));
		return isPlainObject(parsed) ? parsed : {};
	} catch (error) {
		if (isMissingFileError(error)) return null;
		throw error;
	}
}
async function writeOpenCodeConfigFile(configFilePath, config) {
	await ensureParentDirectory(configFilePath);
	await writeFile(configFilePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
function buildInstalledOpenCodeConfig(current) {
	const pluginSpecs = normalizePluginSpecs(current.plugin).filter((pluginSpec) => normalizeNpmPackageName(pluginSpec) !== OPENCODE_TBOT_PACKAGE_NAME);
	pluginSpecs.push(OPENCODE_TBOT_PACKAGE_NAME);
	return {
		$schema: current.$schema ?? OPENCODE_CONFIG_SCHEMA_URL,
		...current,
		plugin: pluginSpecs
	};
}
function buildUninstalledOpenCodeConfig(current) {
	if (typeof current.plugin === "undefined") return current;
	const pluginSpecs = normalizePluginSpecs(current.plugin).filter((pluginSpec) => normalizeNpmPackageName(pluginSpec) !== OPENCODE_TBOT_PACKAGE_NAME);
	const nextConfig = { ...current };
	if (pluginSpecs.length > 0) {
		nextConfig.plugin = pluginSpecs;
		return nextConfig;
	}
	delete nextConfig.plugin;
	return nextConfig;
}
function normalizePluginSpecs(value) {
	if (typeof value === "undefined") return [];
	if (!Array.isArray(value)) throw new Error("OpenCode config plugin field must be an array.");
	const normalizedPluginSpecs = [];
	const seenPluginSpecs = /* @__PURE__ */ new Set();
	for (const entry of value) {
		if (typeof entry !== "string") throw new Error("OpenCode config plugin entries must be strings.");
		const normalizedEntry = entry.trim();
		if (normalizedEntry.length === 0 || seenPluginSpecs.has(normalizedEntry)) continue;
		seenPluginSpecs.add(normalizedEntry);
		normalizedPluginSpecs.push(normalizedEntry);
	}
	return normalizedPluginSpecs;
}
function normalizeNpmPackageName(pluginSpec) {
	const normalizedPluginSpec = pluginSpec.trim();
	if (!normalizedPluginSpec.startsWith("@")) {
		const atIndex = normalizedPluginSpec.indexOf("@");
		return atIndex >= 0 ? normalizedPluginSpec.slice(0, atIndex) : normalizedPluginSpec;
	}
	const versionSeparatorIndex = normalizedPluginSpec.indexOf("@", normalizedPluginSpec.indexOf("/") + 1);
	return versionSeparatorIndex >= 0 ? normalizedPluginSpec.slice(0, versionSeparatorIndex) : normalizedPluginSpec;
}
function createPromptSession(options = {}) {
	const input = options.input ?? stdin;
	const output = options.output ?? stdout;
	if (!input.isTTY || !output.isTTY) return {
		ask: async () => "",
		askSecret: async () => "",
		async confirm(_question, defaultValue) {
			return defaultValue;
		},
		close() {}
	};
	return {
		ask(question) {
			return askQuestion(input, output, question);
		},
		askSecret(question) {
			return askSecretQuestion(input, output, question);
		},
		async confirm(question, defaultValue) {
			const answer = normalizeOptionalString(await askQuestion(input, output, question));
			if (!answer) return defaultValue;
			if (["y", "yes"].includes(answer.toLowerCase())) return true;
			if (["n", "no"].includes(answer.toLowerCase())) return false;
			throw new Error(`Unsupported answer: ${answer}`);
		},
		close() {}
	};
}
async function askQuestion(input, output, question) {
	const readline = createInterface({
		input,
		output
	});
	try {
		return await readline.question(question);
	} finally {
		readline.close();
	}
}
async function askSecretQuestion(input, output, question) {
	if (typeof input.setRawMode !== "function") return askQuestion(input, output, question);
	output.write(question);
	try {
		return await readMaskedInput(input, output);
	} finally {
		output.write("\n");
	}
}
async function readMaskedInput(input, output) {
	return new Promise((resolvePromise, rejectPromise) => {
		const buffer = [];
		let settled = false;
		const cleanup = () => {
			input.off("data", handleData);
			input.off("error", handleError);
			input.pause();
			input.setRawMode?.(false);
		};
		const rejectWith = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			rejectPromise(error);
		};
		const resolveWith = (value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolvePromise(value);
		};
		const handleError = (error) => {
			rejectWith(error);
		};
		const handleData = (chunk) => {
			const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
			for (const character of text) {
				if (character === "\r" || character === "\n") {
					resolveWith(buffer.join(""));
					return;
				}
				if (character === "") {
					rejectWith(new Error(PROMPT_CANCELLED_ERROR));
					return;
				}
				if (character === "\b" || character === "") {
					if (buffer.length > 0) {
						buffer.pop();
						output.write("\b \b");
					}
					continue;
				}
				if (character < " " || character === "") continue;
				buffer.push(character);
				output.write("*");
			}
		};
		input.setRawMode?.(true);
		input.resume();
		input.on("error", handleError);
		input.on("data", handleData);
	});
}
function normalizeOptionalString(value) {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}
function normalizeRequiredString(value, errorMessage) {
	const normalized = normalizeOptionalString(value);
	if (!normalized) throw new Error(errorMessage);
	return normalized;
}
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isMissingFileError(error) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function assertNoConflictingLocalPluginFiles(homeDir) {
	const pluginFilePaths = await listConflictingLocalPluginFiles(getOpenCodeConfigDirectory(homeDir));
	if (pluginFilePaths.length === 0) return;
	throw new Error([
		"Detected a conflicting local OpenCode plugin file:",
		...pluginFilePaths.map((filePath) => `- ${filePath}`),
		"Remove or rename the local file plugin before installing opencode-tbot via npm."
	].join("\n"));
}
async function listConflictingLocalPluginFiles(configDirectory) {
	const pluginsDirectory = join(configDirectory, "plugins");
	try {
		return (await readdir(pluginsDirectory, { withFileTypes: true })).filter((entry) => entry.isFile() && CONFLICTING_LOCAL_PLUGIN_FILE_PATTERN.test(entry.name)).map((entry) => join(pluginsDirectory, entry.name)).sort();
	} catch (error) {
		if (isMissingFileError(error)) return [];
		throw error;
	}
}
function buildHelpText() {
	return [
		"Usage: opencode-tbot [install|update|uninstall] [options]",
		"       opencode-tbot --version",
		"",
		"Recommended npm usage:",
		"  npm exec -- opencode-tbot@latest",
		"  npm exec -- opencode-tbot@latest update",
		"  npm exec -- opencode-tbot@latest uninstall",
		"  npm exec -- opencode-tbot@latest --version",
		"",
		"Commands:",
		"  install",
		"  update",
		"  uninstall",
		"",
		"Options:",
		"  --bot-token <token>",
		"  --telegram-api-root <url>",
		"  --home-dir <path>",
		"  --version",
		"  --help"
	].join("\n");
}
function formatCliError(error) {
	return error instanceof Error && error.message.trim().length > 0 ? error.message.trim() : String(error);
}
//#endregion
export { createPromptSession, installPlugin, main, runCli, uninstallPlugin, updatePlugin };

//# sourceMappingURL=cli.js.map