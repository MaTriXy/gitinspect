import { describe, expect, it } from "vitest";
import { parseCliArgs, renderLoginHelp, renderTopLevelHelp } from "../apps/cli/src/lib/args";

describe("cli args", () => {
  it("renders compact top-level help", () => {
    expect(renderTopLevelHelp()).toContain("gitinspect login");
    expect(renderTopLevelHelp()).toContain("gitinspect login --help");
  });

  it("renders compact login help", () => {
    expect(renderLoginHelp()).toContain("-p, --provider <provider>");
    expect(renderLoginHelp()).toContain("--print-json");
  });

  it("parses login options", () => {
    expect(parseCliArgs(["login", "-p", "codex", "--print-json"])).toEqual({
      args: {
        printJson: true,
        providerAlias: "codex",
      },
      kind: "login",
    });
  });

  it("supports equals provider syntax", () => {
    expect(parseCliArgs(["login", "--provider=anthropic"])).toEqual({
      args: {
        printJson: false,
        providerAlias: "anthropic",
      },
      kind: "login",
    });
  });

  it("rejects unknown commands", () => {
    expect(parseCliArgs(["logout"])).toEqual({
      help: "top",
      kind: "error",
      message: "Unknown command: logout",
    });
  });

  it("rejects positional provider arguments", () => {
    expect(parseCliArgs(["login", "codex"])).toEqual({
      help: "login",
      kind: "error",
      message: "Unexpected argument: codex. Use -p or --provider.",
    });
  });
});
