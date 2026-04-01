import { spawn } from "node:child_process";

const rawRole = String(process.env.BANTABRO_SERVICE_ROLE || "web").trim().toLowerCase();
const role = rawRole === "worker" ? "worker" : "web";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const twitterProvider = String(process.env.TWITTER_WORKER_PROVIDER || "")
  .trim()
  .toLowerCase();
const workerScript = twitterProvider === "eliza" ? "start:worker:eliza" : "start:worker";
const args = role === "worker" ? ["run", workerScript] : ["run", "start:web"];

console.log(`[railway] starting Bant-A-Bro service role: ${role}`);
if (role === "worker") {
  console.log(`[railway] twitter worker provider: ${workerScript}`);
}

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
