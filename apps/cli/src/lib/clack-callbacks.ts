import { isCancel, log, note, spinner, text } from "@clack/prompts";
import { openBrowser } from "./browser.js";
import { copyTextToClipboard } from "./clipboard.js";
import { LoginCancelledError } from "./errors.js";
import type { CliLoginCallbacks } from "./oauth-adapter.js";

export interface ClackBridge {
  callbacks: CliLoginCallbacks;
  cancelPendingManualCodeInput: () => void;
  clearProgress: () => void;
  stopProgress: (message?: string) => void;
}

interface ClackBridgeOptions {
  copyToClipboard?: (text: string) => Promise<boolean>;
  manualCodePromptDelayMs?: number;
  openBrowserUrl?: (url: string) => Promise<boolean>;
  promptText?: typeof text;
  renderLog?: Pick<typeof log, "info" | "step" | "warn">;
  renderNote?: typeof note;
  spinnerFactory?: typeof spinner;
  signal?: AbortSignal;
}

function ensurePromptValue(value: string | symbol): string {
  if (isCancel(value)) {
    throw new LoginCancelledError();
  }

  return value;
}

export function createClackCallbacks(options: ClackBridgeOptions = {}): ClackBridge {
  const copyToClipboard = options.copyToClipboard ?? copyTextToClipboard;
  const manualCodePromptDelayMs = options.manualCodePromptDelayMs ?? 10_000;
  const openBrowserUrl = options.openBrowserUrl ?? openBrowser;
  const promptText = options.promptText ?? text;
  const renderLog = options.renderLog ?? log;
  const renderNote = options.renderNote ?? note;
  const promptSpinner = options.spinnerFactory?.({ signal: options.signal }) ?? spinner();

  let spinnerStarted = false;
  let manualCodePromptController: AbortController | undefined;
  let manualCodePromptTimer: ReturnType<typeof setTimeout> | undefined;

  function startProgress(message: string) {
    if (spinnerStarted) {
      promptSpinner.message(message);
      return;
    }

    promptSpinner.start(message);
    spinnerStarted = true;
  }

  function clearProgress() {
    if (!spinnerStarted) {
      return;
    }

    promptSpinner.clear();
    spinnerStarted = false;
  }

  function stopProgress(message?: string) {
    if (!spinnerStarted) {
      return;
    }

    promptSpinner.stop(message);
    spinnerStarted = false;
  }

  async function runPrompt(
    prompt: {
      allowEmpty?: boolean;
      message: string;
      placeholder?: string;
    },
    signal?: AbortSignal,
  ): Promise<string> {
    if ((signal ?? options.signal)?.aborted) {
      throw new LoginCancelledError();
    }

    const result = await promptText({
      message: prompt.message,
      placeholder: prompt.placeholder,
      signal: signal ?? options.signal,
      validate: prompt.allowEmpty
        ? undefined
        : (value) => {
            if (!value || value.trim().length === 0) {
              return "Value is required";
            }
            return undefined;
          },
    });

    return ensurePromptValue(result);
  }

  function cancelPendingManualCodeInput() {
    if (manualCodePromptTimer) {
      clearTimeout(manualCodePromptTimer);
      manualCodePromptTimer = undefined;
    }

    manualCodePromptController?.abort();
    manualCodePromptController = undefined;
  }

  function promptForManualCodeInput(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const startPrompt = () => {
        manualCodePromptTimer = undefined;
        manualCodePromptController = new AbortController();

        void runPrompt(
          {
            message: "Paste the final redirect URL or authorization code back into this CLI",
          },
          manualCodePromptController.signal,
        )
          .then(resolve)
          .catch(reject)
          .finally(() => {
            manualCodePromptController = undefined;
          });
      };

      if (manualCodePromptDelayMs <= 0) {
        startPrompt();
        return;
      }

      manualCodePromptTimer = setTimeout(startPrompt, manualCodePromptDelayMs);
    });
  }

  const callbacks: CliLoginCallbacks = {
    onAuth(info) {
      stopProgress();

      const lines = [
        "1. Open the sign-in link below.",
        "2. Press ENTER below to open it in your browser.",
        "3. Complete the provider login flow in your browser.",
        "4. If the browser callback does not finish automatically, this CLI will ask for the redirect URL or code after a short wait.",
        "",
        info.url,
      ];

      if (info.instructions) {
        lines.push("", info.instructions);
      }

      renderNote(lines.join("\n"), "Authentication");

      void copyToClipboard(info.url).then((copied) => {
        if (copied) {
          renderLog.step("Copied the sign-in link to your clipboard.");
          return;
        }
        renderLog.warn("Could not copy the sign-in link to your clipboard.");
      });

      void runPrompt(
        {
          allowEmpty: true,
          message: "Press ENTER to open the browser",
        },
        options.signal,
      )
        .then(async () => await openBrowserUrl(info.url))
        .then((opened) => {
          if (opened) {
            renderLog.step("Opened browser.");
            return;
          }
          renderLog.warn("Could not open browser automatically. Open the URL manually.");
        })
        .catch((error: unknown) => {
          if (error instanceof LoginCancelledError) {
            renderLog.warn("Browser was not opened automatically. Open the URL manually.");
            return;
          }
          renderLog.warn("Could not open browser automatically. Open the URL manually.");
        });
    },
    onManualCodeInput() {
      return promptForManualCodeInput();
    },
    onProgress(message) {
      startProgress(message);
    },
    onPrompt(prompt) {
      return runPrompt(prompt);
    },
    signal: options.signal,
  };

  return {
    callbacks,
    cancelPendingManualCodeInput,
    clearProgress,
    stopProgress,
  };
}
