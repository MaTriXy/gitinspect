import { log } from "@clack/prompts";
import { createClackCallbacks } from "../lib/clack-callbacks.js";
import { copyTextToClipboard } from "../lib/clipboard.js";
import { LoginCancelledError } from "../lib/errors.js";
import { loginWithProvider } from "../lib/oauth-adapter.js";
import { formatCredentialsJson, encodeCredentialsBase64 } from "../lib/output.js";
import {
  getProviderLabel,
  normalizeProviderAlias,
  promptForProvider,
  type CliProviderId,
} from "../lib/providers.js";

export interface LoginOptions {
  printJson: boolean;
  providerAlias?: string;
}

export interface LoginCommandDeps {
  copyToClipboard?: (text: string) => Promise<boolean>;
  createCallbacks?: typeof createClackCallbacks;
  selectProvider?: () => Promise<CliProviderId>;
  write?: (message: string) => void;
}

export async function runLoginCommand(
  options: LoginOptions,
  deps: LoginCommandDeps = {},
): Promise<void> {
  const copyToClipboard = deps.copyToClipboard ?? copyTextToClipboard;
  const write = deps.write ?? ((message: string) => process.stdout.write(message));
  const provider = options.providerAlias
    ? normalizeProviderAlias(options.providerAlias)
    : await (deps.selectProvider ?? promptForProvider)();

  if (!provider) {
    throw new Error(`Unsupported provider: ${options.providerAlias}`);
  }

  const bridge = (deps.createCallbacks ?? createClackCallbacks)({});

  try {
    const credentials = await loginWithProvider(provider, bridge.callbacks);
    bridge.cancelPendingManualCodeInput();
    bridge.stopProgress("Login complete");

    const payload = options.printJson
      ? formatCredentialsJson(credentials)
      : encodeCredentialsBase64(credentials);
    const copied = await copyToClipboard(payload);

    if (options.printJson) {
      write(`${payload}\n`);
      return;
    }

    log.success(`Logged in with ${getProviderLabel(provider)}.`);
    if (copied) {
      log.step("Copied the login code to your clipboard.");
    } else {
      log.warn("Could not copy the login code to your clipboard.");
    }
    log.info("Paste the code back inside gitinspect.com");
    write(`\n${payload}\n`);
  } catch (error) {
    bridge.cancelPendingManualCodeInput();
    bridge.clearProgress();
    if (
      error instanceof LoginCancelledError ||
      (error instanceof Error && error.message === "Login cancelled")
    ) {
      throw error;
    }
    throw error;
  }
}
