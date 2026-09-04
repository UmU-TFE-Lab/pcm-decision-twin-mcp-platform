import { spawn } from "node:child_process";
import process from "node:process";

const children = [
  spawn(process.execPath, ["mcp_gateway/server.mjs"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "--", "--port", process.env.PORT || "5173"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!stopping && code) stop(code);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
