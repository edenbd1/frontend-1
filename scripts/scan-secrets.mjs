import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// Inspect shipped assets without ever printing matched credentials.
const patterns = [
  ["Stellar private key", /\bS[A-Z2-7]{55}\b/],
  ["private key PEM", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];
let failures = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:js|html|json|css)$/.test(entry.name)) {
      const source = await readFile(path, "utf8");
      for (const [label, pattern] of patterns) {
        if (pattern.test(source)) {
          console.error(`${path}: possible ${label}`);
          failures++;
        }
      }
    }
  }
}
const DIST = "dist";

// Fail fast with an actionable message instead of a raw ENOENT stack trace
// when the scanner runs before `npm run build` has produced any output.
const distStats = await stat(DIST).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (!distStats?.isDirectory()) {
  console.error(
    `::error::${DIST}/ build output not found — run \`npm run build\` before scanning for secrets.`,
  );
  process.exit(1);
}

await scan(DIST);
if (failures) process.exitCode = 1;
else console.log("Built assets: no recognized private-key patterns found.");
