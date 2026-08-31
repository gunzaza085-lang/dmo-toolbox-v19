'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 17821;

function nodeMajorSupported(version = process.versions.node) {
  return Number(String(version).split('.')[0]) >= 20;
}

function workerPort(env = process.env) {
  const value = Number(env.FACEBOOK_WORKER_PORT || DEFAULT_PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw Error('INVALID_WORKER_PORT');
  return value;
}

function portableProfileDir(env = process.env, homeDir = os.homedir()) {
  if (env.FACEBOOK_WORKER_PROFILE_DIR) return path.resolve(env.FACEBOOK_WORKER_PROFILE_DIR);
  const localData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
  return path.resolve(localData, 'GUN-SHOP-DMO', 'FacebookWorkerProfile');
}

function chromeCandidates(env = process.env) {
  return [
    env.FACEBOOK_WORKER_CHROME_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
}

function findChrome(env = process.env, exists = fs.existsSync) {
  return chromeCandidates(env).find((candidate) => exists(candidate)) || '';
}

function probeWorkerPort(port, options = {}) {
  const host = options.host || DEFAULT_HOST;
  const timeoutMs = Number(options.timeoutMs || 1200);
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: '/status', timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data && data.worker === 'ONLINE' ? 'WORKER' : 'OCCUPIED');
        } catch { resolve('OCCUPIED'); }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve('OCCUPIED'); });
    request.on('error', (error) => resolve(error && error.code === 'ECONNREFUSED' ? 'FREE' : 'OCCUPIED'));
  });
}

async function runPreflight(mode = 'start') {
  if (process.platform !== 'win32') throw Error('WINDOWS_REQUIRED');
  if (!nodeMajorSupported()) throw Error('NODE_20_REQUIRED');
  const chromePath = findChrome();
  if (!chromePath) throw Error('CHROME_NOT_FOUND');
  const port = workerPort();
  const portState = await probeWorkerPort(port);
  if (portState === 'OCCUPIED') throw Error(`PORT_${port}_OCCUPIED_BY_OTHER_PROGRAM`);
  if (portState === 'WORKER') {
    console.log(`[OK] Facebook Worker is already running on port ${port}.`);
    return 10;
  }
  console.log(`[OK] Windows, Node.js ${process.versions.node}, Chrome and port ${port} are ready.`);
  console.log(`[INFO] Browser profile: ${portableProfileDir()}`);
  return 0;
}

if (require.main === module) {
  runPreflight(process.argv[2] || 'start')
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      const messages = {
        WINDOWS_REQUIRED: 'This package supports Windows only.',
        NODE_20_REQUIRED: 'Node.js 20 or newer is required.',
        CHROME_NOT_FOUND: 'Google Chrome was not found. Install Chrome and run this file again.',
      };
      const code = String(error && error.message || error);
      console.error(`[ERROR] ${messages[code] || code.replaceAll('_', ' ')}`);
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  chromeCandidates,
  findChrome,
  nodeMajorSupported,
  portableProfileDir,
  probeWorkerPort,
  runPreflight,
  workerPort,
};
