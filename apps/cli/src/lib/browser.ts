import { spawn } from "node:child_process";

interface BrowserCommand {
  command: string;
  args: string[];
}

function getBrowserCommand(url: string): BrowserCommand {
  switch (process.platform) {
    case "darwin":
      return { args: [url], command: "open" };
    case "win32":
      return { args: ["/c", "start", "", url], command: "cmd" };
    default:
      return { args: [url], command: "xdg-open" };
  }
}

export async function openBrowser(url: string): Promise<boolean> {
  const { command, args } = getBrowserCommand(url);

  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });

    let settled = false;

    child.once("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(false);
    });

    child.once("spawn", () => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve(true);
    });
  });
}
