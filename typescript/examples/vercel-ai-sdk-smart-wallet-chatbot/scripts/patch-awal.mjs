import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const awalPackageRoot = path.join(appRoot, 'node_modules', 'awal');

if (process.platform !== 'win32') {
  console.log('[patch-awal] Non-Windows environment detected; skipping patch.');
  process.exit(0);
}

if (!fs.existsSync(awalPackageRoot)) {
  console.log('[patch-awal] awal is not installed; skipping patch.');
  process.exit(0);
}

const patchReports = [];

if (process.platform === 'win32') {
  const windowsTmpRoot = path.join(process.env.SystemDrive ?? 'C:', 'tmp');
  fs.mkdirSync(windowsTmpRoot, { recursive: true });
}

patchFile(
  path.join(awalPackageRoot, 'dist', 'utils', 'serverManager.js'),
  source => source
    .replace(
      `    const child = spawn(electronBin, [bundleElectron], {\n        detached: true,\n        stdio: 'ignore',\n        env: {`,
      `    const child = spawn(electronBin, [bundleElectron], {\n        detached: true,\n        stdio: 'ignore',\n        shell: process.platform === 'win32',\n        env: {`,
    )
    .replace(
      /        env: \{\n(?:            \.\.\.process\.env,\n            ELECTRON_RUN_AS_NODE: undefined,\n)+            \.\.\.process\.env,\n            STARTED_BY_CLI: 'true',/g,
      `        env: {\n            ...process.env,\n            ELECTRON_RUN_AS_NODE: undefined,\n            STARTED_BY_CLI: 'true',`,
    ),
  'serverManager',
);

patchFile(
  path.join(awalPackageRoot, 'server-bundle', 'bundle-electron.js'),
  patchBundleElectron,
  'server-bundle',
);

patchFile(
  path.join(awalPackageRoot, 'dist', 'ipcClient.js'),
  patchCliPaths,
  'ipcClient',
);

patchFile(
  path.join(awalPackageRoot, 'dist', 'utils', 'processCheck.js'),
  patchCliPaths,
  'processCheck',
);

patchFile(
  path.join(
    process.env.LOCALAPPDATA ?? '',
    'awal-nodejs',
    'Data',
    'server',
    'bundle-electron.js',
  ),
  patchBundleElectron,
  'installed-bundle',
  true,
);

if (patchReports.length === 0) {
  console.log('[patch-awal] No patch changes were needed.');
} else {
  for (const report of patchReports) {
    console.log(`[patch-awal] ${report}`);
  }
}

function patchFile(filePath, transform, label, optional = false) {
  if (!fs.existsSync(filePath)) {
    if (!optional) {
      console.warn(`[patch-awal] ${label}: file not found, skipping.`);
    }
    return;
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const next = transform(source);
  if (next === source) {
    return;
  }

  fs.writeFileSync(filePath, next);
  patchReports.push(`Patched ${label}`);
}

function patchBundleElectron(source) {
  let patched = source;
  patched = patched.replace(
    `try{let l=YT(\`ps -p \${a.pid} -o command=\`,{encoding:"utf8",stdio:"pipe"});if(!(l.includes("payments-mcp-server")||l.includes("payments-mcp-cli")||l.includes("awal-cli")||l.includes("bundle-electron"))){z.security.warning({message:"Rejecting request from non-payments-mcp process",pid:process.pid,senderPid:a.pid,channel:a.channel}),Ce.unlinkSync(r);return}}catch{z.bridge.warning({message:"Could not validate process, rejecting",pid:process.pid,senderPid:a.pid,channel:a.channel}),Ce.unlinkSync(r);return}`,
    `if(process.platform!=="win32")try{let l=YT(\`ps -p \${a.pid} -o command=\`,{encoding:"utf8",stdio:"pipe"});if(!(l.includes("payments-mcp-server")||l.includes("payments-mcp-cli")||l.includes("awal-cli")||l.includes("bundle-electron"))){z.security.warning({message:"Rejecting request from non-payments-mcp process",pid:process.pid,senderPid:a.pid,channel:a.channel}),Ce.unlinkSync(r);return}}catch{z.bridge.warning({message:"Could not validate process, rejecting",pid:process.pid,senderPid:a.pid,channel:a.channel}),Ce.unlinkSync(r);return}`,
  );

  if (process.platform === 'win32') {
    const tmpRoot = os.tmpdir().replace(/\\/g, '/');
    patched = patched
      .replaceAll('/tmp/payments-mcp-ui-bridge', `${tmpRoot}/payments-mcp-ui-bridge`)
      .replaceAll('/tmp/payments-mcp-ui.lock', `${tmpRoot}/payments-mcp-ui.lock`);
  }

  return patched;
}

function patchCliPaths(source) {
  if (process.platform !== 'win32') {
    return source;
  }

  const tmpRoot = os.tmpdir().replace(/\\/g, '/');
  return source
    .replaceAll('/tmp/payments-mcp-ui-bridge', `${tmpRoot}/payments-mcp-ui-bridge`)
    .replaceAll('/tmp/payments-mcp-ui.lock', `${tmpRoot}/payments-mcp-ui.lock`)
    .replaceAll(`fs.mkdirSync(ipcDir, { mode: 0o700 });`, `fs.mkdirSync(ipcDir, { recursive: true, mode: 0o700 });`)
    .replaceAll(`fs.mkdirSync(requestsDir, { mode: 0o700 });`, `fs.mkdirSync(requestsDir, { recursive: true, mode: 0o700 });`)
    .replaceAll(`fs.mkdirSync(responsesDir, { mode: 0o700 });`, `fs.mkdirSync(responsesDir, { recursive: true, mode: 0o700 });`);
}
