// Linux/Render launcher. Mirrors climate-chain/start.ps1: start the in-container Hardhat proof chain on
// loopback, deploy the contracts, then run the supervised gateway on the platform-assigned PORT.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const blockchainDir = join(root, 'blockchain');
const gatewayDir = join(root, 'gateway');
const rpcUrl = 'http://127.0.0.1:18545';
const hardhatCli = join(blockchainDir, 'node_modules', 'hardhat', 'internal', 'cli', 'cli.js');

const env = {
  ...process.env,
  HOST: process.env.HOST || '0.0.0.0',
  CLIMATE_CHAIN_RPC_URL: rpcUrl,
  CLIMATE_CHAIN_DEPLOYMENT: join(blockchainDir, 'deployments', 'localhost.json'),
};

const chain = spawn(process.execPath, [hardhatCli, 'node', '--hostname', '127.0.0.1', '--port', '18545'], {
  cwd: blockchainDir,
  env,
  stdio: 'inherit',
});
let stopping = false;
const stopChain = () => { if (chain.exitCode === null) chain.kill('SIGTERM'); };
chain.once('exit', (code) => {
  if (!stopping) {
    console.error(`Proof chain exited unexpectedly (code ${code}).`);
    process.exit(1);
  }
});

async function chainReady() {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if ((await response.json()).result === '0x7a69') return;
    } catch { /* node still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The proof chain did not become ready on port 18545.');
}

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited with ${code}`))));
  });
}

try {
  await chainReady();
  console.log('Proof chain ready. Deploying evidence contracts...');
  await run([hardhatCli, 'run', 'scripts/deploy.js', '--network', 'localhost'], blockchainDir);
  console.log(`Starting Climate Chain on ${env.HOST}:${env.PORT || 8080}`);
  const supervisor = spawn(process.execPath, ['--use-system-ca', 'mission-supervisor.mjs'], { cwd: gatewayDir, env, stdio: 'inherit' });
  const forward = (signal) => { stopping = true; supervisor.kill(signal); stopChain(); };
  process.once('SIGTERM', () => forward('SIGTERM'));
  process.once('SIGINT', () => forward('SIGINT'));
  supervisor.once('exit', (code) => { stopping = true; stopChain(); process.exit(code ?? 0); });
} catch (error) {
  console.error(error.message);
  stopping = true;
  stopChain();
  process.exit(1);
}
