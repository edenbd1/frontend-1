#!/usr/bin/env node
/**
 * Opens the rollup-plugin-visualizer report (stats.html) in the default
 * browser on macOS, Windows, and Linux, instead of relying on the macOS-only
 * `open` command.
 *
 * Usage: node scripts/open-stats.mjs   (after `npm run build`)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { platform } from "node:process";

const STATS = resolve("stats.html");

if (!existsSync(STATS)) {
  console.error(
    `::error::${STATS} not found — run \`npm run bundle:stats\` (or \`npm run build\`) to generate it.`,
  );
  process.exit(1);
}

// On Windows, explorer.exe opens a file with its default handler. Calling it
// directly avoids `cmd /c start`, where cmd.exe would reinterpret characters
// such as `&`, `^` or `%` in the project path.
const [command, args] =
  platform === "darwin"
    ? ["open", [STATS]]
    : platform === "win32"
      ? ["explorer.exe", [STATS]]
      : ["xdg-open", [STATS]];

const child = spawn(command, args, {
  stdio: "ignore",
  detached: true,
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(`::error::Could not launch \`${command}\` (${error.code ?? error.message}).`);
  console.error(`Open the bundle report manually: ${STATS}`);
  process.exitCode = 1;
});
child.on("spawn", () => {
  child.unref();
  console.log(`Opening bundle report: ${STATS}`);
});
