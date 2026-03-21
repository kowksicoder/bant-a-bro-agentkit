import { spawn } from "node:child_process";

const rawRole = String(process.env.BANTABRO_SERVICE_ROLE || "web").trim().toLowerCase();
const role = rawRole === "worker" ? "worker" : "web";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const args = role === "worker" ? ["run", "start:worker"] : ["run", "start:web"];

console.log(`[railway] starting Bant-A-Bro service role: ${role}`);

const child = spawn(npmCommand, args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", code => {
  process.exit(code ?? 1);
});

child.on("error", error => {
  console.error("[railway] failed to start service:", error);
  process.exit(1);
});
