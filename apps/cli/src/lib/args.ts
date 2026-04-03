export interface LoginCommandArgs {
  printJson: boolean;
  providerAlias?: string;
}

export type ParseCliResult =
  | { kind: "error"; help: "login" | "top"; message: string }
  | { kind: "help-login" }
  | { kind: "help-top" }
  | { args: LoginCommandArgs; kind: "login" };

export function renderTopLevelHelp(): string {
  return [
    "gitinspect",
    "",
    "Usage:",
    "  gitinspect login",
    "  gitinspect login -p <provider>",
    "",
    "Commands:",
    "  login   Login with an OAuth provider",
    "",
    "Use:",
    "  gitinspect login --help",
  ].join("\n");
}

export function renderLoginHelp(): string {
  return [
    "gitinspect login",
    "",
    "Usage:",
    "  gitinspect login",
    "  gitinspect login -p <provider>",
    "",
    "Options:",
    "  -p, --provider <provider>   Provider alias or canonical id",
    "  --print-json                Print raw JSON OAuth credentials",
    "  --help                      Show help",
  ].join("\n");
}

export function parseCliArgs(argv: string[]): ParseCliResult {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { kind: "help-top" };
  }

  const [command, ...rest] = argv;

  if (command !== "login") {
    return {
      help: "top",
      kind: "error",
      message: `Unknown command: ${command}`,
    };
  }

  let printJson = false;
  let providerAlias: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { kind: "help-login" };
    }

    if (arg === "--print-json") {
      printJson = true;
      continue;
    }

    if (arg === "--provider" || arg === "-p") {
      const value = rest[index + 1];
      if (!value) {
        return {
          help: "login",
          kind: "error",
          message: `Missing value for ${arg}`,
        };
      }
      providerAlias = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--provider=")) {
      providerAlias = arg.slice("--provider=".length);
      continue;
    }

    if (arg.startsWith("-p=")) {
      providerAlias = arg.slice(3);
      continue;
    }

    if (arg.startsWith("-")) {
      return {
        help: "login",
        kind: "error",
        message: `Unknown option: ${arg}`,
      };
    }

    return {
      help: "login",
      kind: "error",
      message: `Unexpected argument: ${arg}. Use -p or --provider.`,
    };
  }

  return {
    args: {
      printJson,
      providerAlias,
    },
    kind: "login",
  };
}
