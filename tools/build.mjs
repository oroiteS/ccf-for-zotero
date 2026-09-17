import { execSync } from "node:child_process";

// Ensure cache directories can be written inside sandboxed environments
process.env.HOME = process.env.TMPDIR || "/tmp";

execSync("npx zotero-plugin build", {
  stdio: "inherit",
  env: process.env,
});

execSync("npx tsc --noEmit", {
  stdio: "inherit",
  env: process.env,
});
