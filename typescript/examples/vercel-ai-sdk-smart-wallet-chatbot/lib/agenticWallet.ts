import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

export const AGENTIC_WALLET_CHAINS = ["base", "base-sepolia", "solana", "solana-devnet"] as const;

export const AGENTIC_WALLET_SEND_CHAINS = ["base", "base-sepolia"] as const;

export const AGENTIC_WALLET_ASSETS = ["usdc", "eth", "weth", "sol"] as const;

type AwalResult = Record<string, unknown> | unknown[] | string | number | boolean | null;

/**
 * Execute the local awal CLI and return either parsed JSON or raw output.
 *
 * @param args - CLI arguments after the "awal" binary name
 * @param options - Execution options
 * @param options.json - Whether to append and parse --json
 * @param options.timeoutMs - Command timeout
 * @returns Parsed CLI result
 */
async function runAwalCommand(
  args: string[],
  options: { json?: boolean; timeoutMs?: number } = {},
): Promise<AwalResult> {
  const json = options.json ?? true;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const binary = resolveAwalBinary();
  const finalArgs =
    binary === "npx" || binary === "npx.cmd"
      ? ["awal", ...args, ...(json ? ["--json"] : [])]
      : [...args, ...(json ? ["--json"] : [])];

  return new Promise((resolve, reject) => {
    const child = spawn(binary, finalArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`Agentic Wallet command timed out: awal ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    child.on("error", error => {
      if (settled) {
        return;
      }

      clearTimeout(timer);
      settled = true;
      reject(new Error(`Failed to run awal: ${error.message}`));
    });

    child.on("close", code => {
      if (settled) {
        return;
      }

      clearTimeout(timer);
      settled = true;

      if (code !== 0) {
        reject(new Error(formatAwalError(args, stdout, stderr)));
        return;
      }

      if (!json) {
        resolve(stdout.trim() || stderr.trim() || "Command completed.");
        return;
      }

      resolve(parseAwalJson(stdout));
    });
  });
}

/**
 * Resolve the best available awal executable, preferring the local package binary.
 *
 * @returns Path or command name for the awal CLI
 */
function resolveAwalBinary(): string {
  const localBinary = path.resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "awal.cmd" : "awal",
  );

  if (fs.existsSync(localBinary)) {
    return localBinary;
  }

  return process.platform === "win32" ? "npx.cmd" : "npx";
}

/**
 * Parse JSON output from awal while tolerating harmless prefix lines.
 *
 * @param raw - Raw stdout
 * @returns Parsed JSON or a raw wrapper when JSON is unavailable
 */
function parseAwalJson(raw: string): AwalResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const candidates = [trimmed, trimmed.split(/\r?\n/).filter(Boolean).at(-1)].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  const firstJsonIndex = trimmed.search(/[[{]/);
  if (firstJsonIndex >= 0) {
    candidates.push(trimmed.slice(firstJsonIndex));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as AwalResult;
    } catch {
      // Continue until a valid JSON payload is found.
    }
  }

  return { raw: trimmed };
}

/**
 * Turn awal stdout/stderr into a compact error message.
 *
 * @param args - CLI args used for the command
 * @param stdout - Raw stdout
 * @param stderr - Raw stderr
 * @returns Human-readable error string
 */
function formatAwalError(args: string[], stdout: string, stderr: string): string {
  const combined = [stderr, stdout]
    .join("\n")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const lastLine = combined.at(-1);
  if (lastLine) {
    return `Agentic Wallet command failed (awal ${args.join(" ")}): ${lastLine}`;
  }

  return `Agentic Wallet command failed: awal ${args.join(" ")}`;
}

/**
 * Check the current local agentic wallet status.
 *
 * @returns Status payload from awal
 */
export async function getAgenticWalletStatus(): Promise<AwalResult> {
  return runAwalCommand(["status"]);
}

/**
 * Start email OTP authentication for the local agentic wallet.
 *
 * @param email - Email address to authenticate
 * @returns Flow information from awal
 */
export async function loginAgenticWallet(email: string): Promise<AwalResult> {
  return runAwalCommand(["auth", "login", email]);
}

/**
 * Complete email OTP authentication for the local agentic wallet.
 *
 * @param flowId - Flow ID returned by login
 * @param otp - 6-digit OTP code
 * @returns Verification result from awal
 */
export async function verifyAgenticWallet(flowId: string, otp: string): Promise<AwalResult> {
  return runAwalCommand(["auth", "verify", flowId, otp]);
}

/**
 * Get the local agentic wallet address.
 *
 * @param chain - Optional chain selector
 * @returns Address payload from awal
 */
export async function getAgenticWalletAddress(
  chain?: (typeof AGENTIC_WALLET_CHAINS)[number],
): Promise<AwalResult> {
  const args = ["address"];
  if (chain) {
    args.push("--chain", chain);
  }

  return runAwalCommand(args);
}

/**
 * Get the local agentic wallet balance.
 *
 * @param options - Optional filtering arguments
 * @param options.chain - Chain filter
 * @param options.asset - Asset filter
 * @returns Balance payload from awal
 */
export async function getAgenticWalletBalance(
  options: {
    chain?: (typeof AGENTIC_WALLET_CHAINS)[number];
    asset?: (typeof AGENTIC_WALLET_ASSETS)[number];
  } = {},
): Promise<AwalResult> {
  const args = ["balance"];
  if (options.chain) {
    args.push("--chain", options.chain);
  }
  if (options.asset) {
    args.push("--asset", options.asset);
  }

  return runAwalCommand(args);
}

/**
 * Send USDC from the authenticated agentic wallet.
 *
 * @param amount - Amount to send
 * @param recipient - Recipient address or ENS name
 * @param chain - Optional supported chain
 * @returns Transfer payload from awal
 */
export async function sendAgenticWalletUsdc(
  amount: string,
  recipient: string,
  chain?: (typeof AGENTIC_WALLET_SEND_CHAINS)[number],
): Promise<AwalResult> {
  const args = ["send", amount, recipient];
  if (chain) {
    args.push("--chain", chain);
  }

  return runAwalCommand(args);
}

/**
 * Trade tokens using the authenticated agentic wallet.
 *
 * @param amount - Amount string accepted by awal
 * @param fromAsset - Source token symbol or contract address
 * @param toAsset - Destination token symbol or contract address
 * @returns Trade payload from awal
 */
export async function tradeAgenticWallet(
  amount: string,
  fromAsset: string,
  toAsset: string,
): Promise<AwalResult> {
  return runAwalCommand(["trade", amount, fromAsset, toAsset]);
}

/**
 * Open the Agentic Wallet companion window for manual funding and inspection.
 *
 * @returns Human-readable confirmation string
 */
export async function showAgenticWallet(): Promise<string> {
  await runAwalCommand(["show"], { json: false, timeoutMs: 30_000 });
  return "Opened the Agentic Wallet companion window.";
}

/**
 * Open the funding experience for the Agentic Wallet and return funding guidance.
 *
 * @returns Funding instructions plus the current wallet address payload when available
 */
export async function fundAgenticWallet(): Promise<{
  message: string;
  companionOpened: boolean;
  address?: AwalResult;
}> {
  let companionOpened = false;

  try {
    await showAgenticWallet();
    companionOpened = true;
  } catch {
    companionOpened = false;
  }

  let address: AwalResult | undefined;
  try {
    address = await getAgenticWalletAddress();
  } catch {
    address = undefined;
  }

  return {
    message: companionOpened
      ? "Opened the Agentic Wallet companion window. Use the funding or onramp flow there to add money to the wallet."
      : "Agentic Wallet funding uses the wallet companion or onramp flow. I could not open the companion automatically, but you can still fund the wallet manually with the address below.",
    companionOpened,
    address,
  };
}
