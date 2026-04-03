import { cancel, log } from "@clack/prompts";
import { runLoginCommand } from "./commands/login.js";
import { parseCliArgs, renderLoginHelp, renderTopLevelHelp } from "./lib/args.js";
import { isLoginCancelledError } from "./lib/errors.js";

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseCliArgs(argv);

  switch (parsed.kind) {
    case "help-top": {
      writeLine(renderTopLevelHelp());
      return 0;
    }
    case "help-login": {
      writeLine(renderLoginHelp());
      return 0;
    }
    case "error": {
      log.error(parsed.message);
      writeLine(parsed.help === "login" ? renderLoginHelp() : renderTopLevelHelp());
      return 1;
    }
    case "login": {
      try {
        await runLoginCommand(parsed.args);
        return 0;
      } catch (error) {
        if (error instanceof Error && isLoginCancelledError(error)) {
          cancel("Login cancelled");
          return 1;
        }
        log.error(error instanceof Error ? error.message : "Login failed");
        return 1;
      }
    }
  }
}
