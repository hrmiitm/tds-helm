"use strict";
/**
 * Engine Endpoint Discovery
 * Reference: upgrade.md Section 4.2
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findCliPath = findCliPath;
exports.discoverEngine = discoverEngine;
exports.normalizeEndpoint = normalizeEndpoint;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const contracts_1 = require("../contracts");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function findCliPath(binaryName) {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'where' : 'which';
    const name = isWindows ? `${binaryName}.exe` : binaryName;
    try {
        const { stdout } = await execFileAsync(cmd, [name], { timeout: 2000, shell: false });
        const firstLine = stdout.trim().split(/\r?\n/)[0];
        if (firstLine && fs.existsSync(firstLine)) {
            return firstLine;
        }
    }
    catch {
        // Binary not found via which/where
    }
    // Fallback well-known paths
    const commonPaths = isWindows
        ? [
            `C:\\Program Files\\Docker\\Docker\\resources\\bin\\${name}`,
            `C:\\Program Files\\RedHat\\Podman\\${name}`,
        ]
        : [
            `/usr/bin/${name}`,
            `/usr/local/bin/${name}`,
            `/opt/homebrew/bin/${name}`,
            `/usr/local/opt/podman/bin/${name}`,
        ];
    for (const candidate of commonPaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
async function discoverEngine(options = {}) {
    const platform = process.platform;
    const isWindows = platform === 'win32';
    const isMac = platform === 'darwin';
    // 1. Explicit endpoint
    if (options.explicitEndpoint) {
        const ep = options.explicitEndpoint;
        const isPipe = ep.startsWith('//./pipe/') || ep.startsWith('\\\\.\\pipe\\') || ep.startsWith('npipe://');
        const isTcp = ep.startsWith('tcp://') || ep.startsWith('http://');
        const transport = isPipe ? 'named_pipe' : isTcp ? 'tcp' : 'socket';
        const normalizedEndpoint = normalizeEndpoint(ep);
        const engineType = options.preferredEngine || (ep.includes('podman') ? 'podman' : 'docker');
        const cliPath = options.explicitCliPath || (await findCliPath(engineType));
        return {
            engineType,
            transport,
            endpoint: normalizedEndpoint,
            cliPath,
            isRootless: normalizedEndpoint.includes('podman') || normalizedEndpoint.includes(process.env.XDG_RUNTIME_DIR || 'not-found'),
        };
    }
    // 2. Check environment variables
    const envHost = process.env.DOCKER_HOST || process.env.CONTAINER_HOST;
    if (envHost) {
        const isPipe = envHost.startsWith('npipe://') || envHost.includes('pipe');
        const isTcp = envHost.startsWith('tcp://') || envHost.startsWith('http://');
        const transport = isPipe ? 'named_pipe' : isTcp ? 'tcp' : 'socket';
        const normalizedEndpoint = normalizeEndpoint(envHost);
        const engineType = options.preferredEngine || (envHost.includes('podman') ? 'podman' : 'docker');
        const cliPath = await findCliPath(engineType);
        return {
            engineType,
            transport,
            endpoint: normalizedEndpoint,
            cliPath,
            isRootless: normalizedEndpoint.includes(process.env.XDG_RUNTIME_DIR || 'not-found'),
        };
    }
    // 3. Platform default checks
    const xdgRuntime = process.env.XDG_RUNTIME_DIR;
    const homeDir = os.homedir();
    const candidates = [];
    if (isWindows) {
        candidates.push({
            engineType: 'docker',
            transport: 'named_pipe',
            endpoint: '//./pipe/docker_engine',
            isRootless: false,
        });
    }
    else if (isMac) {
        candidates.push({
            engineType: 'docker',
            transport: 'socket',
            endpoint: path.join(homeDir, '.docker/run/docker.sock'),
            isRootless: false,
        });
        candidates.push({
            engineType: 'docker',
            transport: 'socket',
            endpoint: '/var/run/docker.sock',
            isRootless: false,
        });
        candidates.push({
            engineType: 'podman',
            transport: 'socket',
            endpoint: path.join(homeDir, '.local/share/containers/podman/machine/podman.sock'),
            isRootless: true,
        });
    }
    else {
        // Linux
        if (xdgRuntime) {
            candidates.push({
                engineType: 'podman',
                transport: 'socket',
                endpoint: path.join(xdgRuntime, 'podman/podman.sock'),
                isRootless: true,
            });
            candidates.push({
                engineType: 'docker',
                transport: 'socket',
                endpoint: path.join(xdgRuntime, 'docker.sock'),
                isRootless: true,
            });
        }
        candidates.push({
            engineType: 'docker',
            transport: 'socket',
            endpoint: '/var/run/docker.sock',
            isRootless: false,
        });
        candidates.push({
            engineType: 'podman',
            transport: 'socket',
            endpoint: '/run/podman/podman.sock',
            isRootless: false,
        });
    }
    // Apply preference ordering
    const preferred = options.preferredEngine;
    if (preferred) {
        candidates.sort((a, b) => {
            if (a.engineType === preferred && b.engineType !== preferred)
                return -1;
            if (b.engineType === preferred && a.engineType !== preferred)
                return 1;
            return 0;
        });
    }
    else {
        // Deterministically prefer reachable Docker by default
        candidates.sort((a, b) => {
            if (a.engineType === 'docker' && b.engineType !== 'docker')
                return -1;
            if (b.engineType === 'docker' && a.engineType !== 'docker')
                return 1;
            return 0;
        });
    }
    // Test existence of sockets / pipes
    for (const cand of candidates) {
        if (cand.transport === 'socket' && fs.existsSync(cand.endpoint)) {
            const cliPath = await findCliPath(cand.engineType);
            return {
                ...cand,
                cliPath,
            };
        }
        if (cand.transport === 'named_pipe') {
            const cliPath = await findCliPath(cand.engineType);
            return {
                ...cand,
                cliPath,
            };
        }
    }
    // If no socket file exists, fallback to available CLI
    const dockerCli = await findCliPath('docker');
    const podmanCli = await findCliPath('podman');
    if (preferred === 'podman' && podmanCli) {
        return {
            engineType: 'podman',
            transport: 'socket',
            endpoint: xdgRuntime ? path.join(xdgRuntime, 'podman/podman.sock') : '/run/podman/podman.sock',
            cliPath: podmanCli,
            isRootless: !!xdgRuntime,
        };
    }
    if (dockerCli) {
        return {
            engineType: 'docker',
            transport: isWindows ? 'named_pipe' : 'socket',
            endpoint: isWindows ? '//./pipe/docker_engine' : '/var/run/docker.sock',
            cliPath: dockerCli,
            isRootless: false,
        };
    }
    if (podmanCli) {
        return {
            engineType: 'podman',
            transport: 'socket',
            endpoint: xdgRuntime ? path.join(xdgRuntime, 'podman/podman.sock') : '/run/podman/podman.sock',
            cliPath: podmanCli,
            isRootless: !!xdgRuntime,
        };
    }
    throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, 'No reachable Docker or Podman engine socket or CLI was detected on this system');
}
function normalizeEndpoint(endpoint) {
    let ep = endpoint.trim();
    if (ep.startsWith('unix://')) {
        ep = ep.substring(7);
    }
    else if (ep.startsWith('npipe://')) {
        ep = ep.substring(8);
    }
    return ep;
}
