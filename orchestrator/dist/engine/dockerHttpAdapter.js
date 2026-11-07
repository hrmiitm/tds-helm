"use strict";
/**
 * Docker & Podman Engine HTTP API Adapter
 * Reference: upgrade.md Sections 4.1, 4.2, 4.3, 4.4
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
exports.DockerHttpAdapter = void 0;
const http = __importStar(require("http"));
const stream_1 = require("stream");
const contracts_1 = require("../contracts");
const errorMapping_1 = require("./errorMapping");
const engineDiscovery_1 = require("./engineDiscovery");
class DockerHttpAdapter {
    socketPath;
    host;
    port;
    engineType;
    defaultTimeoutMs;
    constructor(options = {}) {
        this.engineType = options.engineType || 'docker';
        this.defaultTimeoutMs = options.timeoutMs ?? 30000;
        if (options.host) {
            this.host = options.host;
            this.port = options.port || (this.engineType === 'podman' ? 8888 : 2375);
        }
        else {
            const ep = options.socketPath || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock');
            this.socketPath = (0, engineDiscovery_1.normalizeEndpoint)(ep);
        }
    }
    request(method, path, body, timeoutMs, headers) {
        return new Promise((resolve, reject) => {
            const isBuffer = Buffer.isBuffer(body);
            const isStream = body instanceof stream_1.Readable;
            const jsonBody = !isBuffer && !isStream && body !== undefined ? JSON.stringify(body) : undefined;
            const reqHeaders = {
                Host: 'docker.local',
                ...headers,
            };
            if (jsonBody) {
                reqHeaders['Content-Type'] = 'application/json';
                reqHeaders['Content-Length'] = String(Buffer.byteLength(jsonBody));
            }
            else if (isBuffer) {
                reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/x-tar';
                reqHeaders['Content-Length'] = String(body.length);
            }
            const reqOptions = {
                method,
                path,
                headers: reqHeaders,
                timeout: timeoutMs ?? this.defaultTimeoutMs,
            };
            if (this.socketPath) {
                reqOptions.socketPath = this.socketPath;
            }
            else {
                reqOptions.host = this.host;
                reqOptions.port = this.port;
            }
            const req = http.request(reqOptions, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode || 0,
                        data: Buffer.concat(chunks),
                        headers: res.headers,
                    });
                });
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new contracts_1.EngineError(contracts_1.StudioErrorCode.READINESS_TIMEOUT, `Engine HTTP request timed out after ${timeoutMs ?? this.defaultTimeoutMs}ms on ${method} ${path}`));
            });
            req.on('error', (err) => {
                reject((0, errorMapping_1.mapEngineError)(err, `HTTP request failed on ${method} ${path}`));
            });
            if (jsonBody) {
                req.write(jsonBody);
                req.end();
            }
            else if (isBuffer) {
                req.write(body);
                req.end();
            }
            else if (isStream) {
                body.pipe(req);
            }
            else {
                req.end();
            }
        });
    }
    async probe() {
        try {
            const [verRes, infoRes] = await Promise.all([
                this.request('GET', '/version', undefined, 10000),
                this.request('GET', '/info', undefined, 10000),
            ]);
            if (verRes.statusCode >= 400 || infoRes.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Engine probe HTTP failed with status ${verRes.statusCode} / ${infoRes.statusCode}`);
            }
            const ver = JSON.parse(verRes.data.toString('utf8'));
            const info = JSON.parse(infoRes.data.toString('utf8'));
            const serverVersion = String(ver.Version || info.ServerVersion || '0.0.0');
            const apiVersion = String(ver.ApiVersion || '1.45');
            const osType = String(ver.Os || info.OSType || process.platform);
            const arch = String(ver.Arch || info.Architecture || process.arch);
            const cgroupVersion = String(info.CgroupVersion || (info.CgroupDriver ? 'v2' : 'v1'));
            const isRootless = !!(info.SecurityOptions?.some((opt) => opt.includes('rootless')) ||
                info.Rootless ||
                this.engineType === 'podman');
            return {
                engineType: this.engineType,
                version: serverVersion,
                apiVersion,
                os: osType,
                arch,
                cgroupVersion,
                supportsCpuLimits: true,
                supportsMemoryLimits: true,
                supportsSwapLimits: !isRootless,
                supportsPidsLimit: true,
                supportsNoCopyMounts: this.engineType === 'docker',
                isRootless,
                endpoint: this.socketPath || `${this.host}:${this.port}`,
                availableMemoryBytes: typeof info.MemTotal === 'number' ? info.MemTotal : undefined,
                availableCpus: typeof info.NCPU === 'number' ? info.NCPU : undefined,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, 'Engine probe HTTP failed');
        }
    }
    async listOwned(installationId) {
        try {
            const res = await this.request('GET', '/containers/json?all=1');
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to list containers: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
            const list = JSON.parse(res.data.toString('utf8'));
            const snapshots = [];
            for (const item of list) {
                const names = item.Names || [];
                const isStudioName = names.some((n) => n.includes('rag-studio'));
                const labels = item.Labels || {};
                const isStudioLabel = (0, contracts_1.isManagedByStudio)(labels);
                if (isStudioName || isStudioLabel) {
                    const snap = await this.inspectContainer(item.Id);
                    if (snap) {
                        snapshots.push(snap);
                    }
                }
            }
            return snapshots;
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to list owned containers for installation ${installationId}`);
        }
    }
    async inspectContainer(id) {
        try {
            const res = await this.request('GET', `/containers/${encodeURIComponent(id)}/json`);
            if (res.statusCode === 404) {
                return null;
            }
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to inspect container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
            const data = JSON.parse(res.data.toString('utf8'));
            return this.mapContainerInspection(data);
        }
        catch (err) {
            const mapped = (0, errorMapping_1.mapEngineError)(err);
            if (mapped.code === contracts_1.StudioErrorCode.NAME_CONFLICT || mapped.message.includes('not found')) {
                return null;
            }
            throw mapped;
        }
    }
    async ensureImage(ref) {
        try {
            // Check if image exists locally
            const inspectRes = await this.request('GET', `/images/${encodeURIComponent(ref.image)}/json`);
            if (inspectRes.statusCode === 200) {
                const data = JSON.parse(inspectRes.data.toString('utf8'));
                return {
                    id: data.Id,
                    digest: data.RepoDigests?.[0] || data.Id,
                    repoTags: data.RepoTags,
                };
            }
        }
        catch {
            // Not found locally
        }
        try {
            // Pull image
            const pullRes = await this.request('POST', `/images/create?fromImage=${encodeURIComponent(ref.image)}`, undefined, 180000);
            if (pullRes.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.IMAGE_UNAVAILABLE, `Failed to pull image ${ref.image}: HTTP ${pullRes.statusCode} ${pullRes.data.toString('utf8')}`);
            }
            const inspectRes = await this.request('GET', `/images/${encodeURIComponent(ref.image)}/json`);
            const data = JSON.parse(inspectRes.data.toString('utf8'));
            return {
                id: data.Id,
                digest: data.RepoDigests?.[0] || data.Id,
                repoTags: data.RepoTags,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to ensure image: ${ref.image}`);
        }
    }
    async ensureVolume(spec) {
        try {
            // Check existing
            const inspectRes = await this.request('GET', `/volumes/${encodeURIComponent(spec.name)}`);
            if (inspectRes.statusCode === 200) {
                const vol = JSON.parse(inspectRes.data.toString('utf8'));
                const labels = vol.Labels || {};
                if (!(0, contracts_1.isManagedByStudio)(labels, spec.name)) {
                    throw new contracts_1.EngineError(contracts_1.StudioErrorCode.NAME_CONFLICT, `Volume ${spec.name} exists but is not managed by Studio Universal`);
                }
                if (labels[contracts_1.STUDIO_LABEL_KEYS.INSTALLATION] && labels[contracts_1.STUDIO_LABEL_KEYS.INSTALLATION] !== spec.installationId) {
                    throw new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Volume ${spec.name} is owned by another installation`);
                }
                return {
                    name: vol.Name,
                    driver: vol.Driver || 'local',
                    labels,
                    mountpoint: vol.Mountpoint,
                    created: vol.CreatedAt,
                };
            }
        }
        catch (err) {
            if (err instanceof contracts_1.EngineError && err.code !== contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE) {
                throw err;
            }
        }
        try {
            const labels = {
                [contracts_1.STUDIO_LABEL_KEYS.MANAGED]: 'true',
                [contracts_1.STUDIO_LABEL_KEYS.INSTALLATION]: spec.installationId,
                [contracts_1.STUDIO_LABEL_KEYS.ROLE]: spec.role,
                ...(spec.chapterId ? { [contracts_1.STUDIO_LABEL_KEYS.CHAPTER]: spec.chapterId } : {}),
                ...(spec.labels || {}),
            };
            const body = {
                Name: spec.name,
                Driver: spec.driver || 'local',
                Labels: labels,
            };
            const res = await this.request('POST', '/volumes/create', body);
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to create volume ${spec.name}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
            const vol = JSON.parse(res.data.toString('utf8'));
            return {
                name: vol.Name,
                driver: vol.Driver || 'local',
                labels: vol.Labels || labels,
                mountpoint: vol.Mountpoint,
                created: vol.CreatedAt,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to ensure volume ${spec.name}`);
        }
    }
    async createContainer(spec) {
        const limits = (0, contracts_1.validateResourceCeilings)(spec.resources);
        const labels = {
            [contracts_1.STUDIO_LABEL_KEYS.MANAGED]: 'true',
            [contracts_1.STUDIO_LABEL_KEYS.INSTALLATION]: spec.installationId,
            [contracts_1.STUDIO_LABEL_KEYS.ROLE]: spec.role,
            [contracts_1.STUDIO_LABEL_KEYS.CHAPTER]: spec.chapterId,
            [contracts_1.STUDIO_LABEL_KEYS.GENERATION]: String(spec.generation),
            ...(spec.labels || {}),
        };
        const envArray = [];
        if (spec.env) {
            for (const [k, v] of Object.entries(spec.env)) {
                envArray.push(`${k}=${v}`);
            }
        }
        const binds = spec.volumes.map((v) => `${v.source}:${v.target}:${v.readOnly ? 'ro' : 'rw'}`);
        const exposedPorts = {};
        const portBindings = {};
        if (spec.portBindings) {
            for (const p of spec.portBindings) {
                const key = `${p.containerPort}/${p.protocol || 'tcp'}`;
                exposedPorts[key] = {};
                portBindings[key] = [
                    {
                        HostIp: p.hostIp || '127.0.0.1',
                        HostPort: p.hostPort !== undefined ? String(p.hostPort) : '0',
                    },
                ];
            }
        }
        const stopGrace = spec.stopGraceSeconds ?? contracts_1.RESOURCE_CEILINGS.DEFAULT_STOP_GRACE_SECONDS;
        // Convert cpuMilli to NanoCPUs (1 CPU = 1_000_000_000 NanoCPUs)
        const nanoCpus = limits.cpuMilli * 1_000_000;
        const createBody = {
            Image: spec.image,
            Cmd: spec.command,
            Entrypoint: spec.entrypoint,
            Env: envArray,
            Labels: labels,
            User: spec.user,
            StopTimeout: stopGrace,
            ExposedPorts: exposedPorts,
            HostConfig: {
                Binds: binds,
                PortBindings: portBindings,
                NanoCPUs: nanoCpus,
                Memory: limits.memoryBytes,
                MemorySwap: limits.memorySwapBytes ?? limits.memoryBytes,
                PidsLimit: limits.pidsLimit,
                Init: spec.init !== false,
                ReadonlyRootfs: !!spec.readOnlyRootFilesystem,
                RestartPolicy: { Name: 'no' },
                NetworkMode: spec.network || 'default',
            },
        };
        try {
            const res = await this.request('POST', `/containers/create?name=${encodeURIComponent(spec.name)}`, createBody);
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(res.statusCode === 409 ? contracts_1.StudioErrorCode.NAME_CONFLICT : contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to create container ${spec.name}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`, { details: { statusCode: res.statusCode, body: res.data.toString('utf8') } });
            }
            const parsed = JSON.parse(res.data.toString('utf8'));
            return parsed.Id;
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to create container ${spec.name}`);
        }
    }
    async startContainer(id) {
        try {
            const res = await this.request('POST', `/containers/${encodeURIComponent(id)}/start`);
            if (res.statusCode >= 400 && res.statusCode !== 304) {
                throw new contracts_1.EngineError(res.statusCode === 409 ? contracts_1.StudioErrorCode.PORT_IN_USE : contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to start container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to start container ${id}`);
        }
    }
    async stopContainer(id, graceSeconds) {
        try {
            const res = await this.request('POST', `/containers/${encodeURIComponent(id)}/stop?t=${graceSeconds}`, undefined, (graceSeconds + 10) * 1000);
            if (res.statusCode >= 400 && res.statusCode !== 304) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.STOP_FAILED, `Failed to stop container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to stop container ${id}`);
        }
    }
    async killContainer(id) {
        try {
            const res = await this.request('POST', `/containers/${encodeURIComponent(id)}/kill`);
            if (res.statusCode >= 400 && res.statusCode !== 304) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to kill container ${id}: HTTP ${res.statusCode}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to kill container ${id}`);
        }
    }
    async removeContainer(id) {
        const snap = await this.inspectContainer(id);
        if (!snap) {
            return; // Already deleted
        }
        if (!(0, contracts_1.isManagedByStudio)(snap.labels, snap.name)) {
            throw new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Refusing to delete container ${id}: object is not managed by Studio Universal`);
        }
        try {
            const res = await this.request('DELETE', `/containers/${encodeURIComponent(id)}?force=true`);
            if (res.statusCode >= 400 && res.statusCode !== 404) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to remove container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to remove container ${id}`);
        }
    }
    async removeVolume(id) {
        try {
            const inspectRes = await this.request('GET', `/volumes/${encodeURIComponent(id)}`);
            if (inspectRes.statusCode === 200) {
                const vol = JSON.parse(inspectRes.data.toString('utf8'));
                if (!(0, contracts_1.isManagedByStudio)(vol.Labels, id)) {
                    throw new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Refusing to delete volume ${id}: object is not managed by Studio Universal`);
                }
            }
            else if (inspectRes.statusCode === 404) {
                return; // Already absent
            }
        }
        catch (err) {
            if (err instanceof contracts_1.EngineError)
                throw err;
            return;
        }
        try {
            const res = await this.request('DELETE', `/volumes/${encodeURIComponent(id)}?force=true`);
            if (res.statusCode >= 400 && res.statusCode !== 404) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to remove volume ${id}: HTTP ${res.statusCode}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to remove volume ${id}`);
        }
    }
    async inspectNetwork(id) {
        try {
            const res = await this.request('GET', `/networks/${encodeURIComponent(id)}`);
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Network not found: ${id} (HTTP ${res.statusCode})`);
            }
            const net = JSON.parse(res.data.toString('utf8'));
            return {
                id: net.Id,
                name: net.Name,
                driver: net.Driver || 'bridge',
                labels: net.Labels || {},
                internal: !!net.Internal,
                subnet: net.IPAM?.Config?.[0]?.Subnet,
                gateway: net.IPAM?.Config?.[0]?.Gateway,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to inspect network ${id}`);
        }
    }
    async ensureNetwork(spec) {
        try {
            return await this.inspectNetwork(spec.name);
        }
        catch {
            // Network does not exist, create it
        }
        try {
            const labels = {
                [contracts_1.STUDIO_LABEL_KEYS.MANAGED]: 'true',
                [contracts_1.STUDIO_LABEL_KEYS.INSTALLATION]: spec.installationId,
                [contracts_1.STUDIO_LABEL_KEYS.ROLE]: spec.role,
                ...(spec.labels || {}),
            };
            const body = {
                Name: spec.name,
                CheckDuplicate: true,
                Internal: !!spec.internal,
                Labels: labels,
            };
            const res = await this.request('POST', '/networks/create', body);
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to create network ${spec.name}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
            return await this.inspectNetwork(spec.name);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to ensure network ${spec.name}`);
        }
    }
    async removeNetwork(id) {
        try {
            const net = await this.inspectNetwork(id);
            if (!(0, contracts_1.isManagedByStudio)(net.labels)) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Refusing to delete network ${id}: object is not managed by Studio Universal`);
            }
            const res = await this.request('DELETE', `/networks/${encodeURIComponent(id)}`);
            if (res.statusCode >= 400 && res.statusCode !== 404) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to remove network ${id}: HTTP ${res.statusCode}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to remove network ${id}`);
        }
    }
    async copyArchive(id, archive) {
        try {
            const res = await this.request('PUT', `/containers/${encodeURIComponent(id)}/archive?path=${encodeURIComponent(archive.destinationPath)}`, archive.content, 60000, { 'Content-Type': 'application/x-tar' });
            if (res.statusCode >= 400) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Failed to copy archive to container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`);
            }
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to copy archive to container ${id}`);
        }
    }
    async *logs(id, maxBytes) {
        const res = await this.request('GET', `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&tail=500`);
        if (res.statusCode === 200) {
            const data = res.data;
            let offset = 0;
            while (offset + 8 <= data.length) {
                const streamType = data.readUInt8(offset);
                const size = data.readUInt32BE(offset + 4);
                offset += 8;
                if (offset + size > data.length) {
                    break;
                }
                const chunk = data.subarray(offset, offset + size).toString('utf8');
                offset += size;
                yield {
                    stream: streamType === 2 ? 'stderr' : 'stdout',
                    data: chunk.slice(-maxBytes),
                };
            }
            // If raw output didn't follow docker stream multiplex header format
            if (offset === 0 && data.length > 0) {
                yield {
                    stream: 'stdout',
                    data: data.toString('utf8').slice(-maxBytes),
                };
            }
        }
    }
    async *events() {
        // Basic event polling or connection
        const res = await this.request('GET', '/events?since=0');
        if (res.statusCode === 200) {
            const lines = res.data.toString('utf8').split(/\r?\n/);
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const ev = JSON.parse(line);
                    yield {
                        type: ev.Type || 'container',
                        action: ev.Action || '',
                        actor: {
                            id: ev.Actor?.ID || '',
                            attributes: ev.Actor?.Attributes || {},
                        },
                        time: ev.time || Date.now(),
                    };
                }
                catch {
                    // ignore malformed line
                }
            }
        }
    }
    mapContainerInspection(data) {
        const id = data.Id || '';
        const name = String(data.Name || '').replace(/^\//, '');
        const stateObj = data.State || {};
        const status = String(stateObj.Status || 'unknown').toLowerCase();
        let state;
        switch (status) {
            case 'running':
                state = contracts_1.LifecycleState.RUNNING;
                break;
            case 'exited':
            case 'dead':
                state = contracts_1.LifecycleState.STOPPED;
                break;
            case 'paused':
            case 'restarting':
                state = contracts_1.LifecycleState.STARTING;
                break;
            case 'created':
                state = contracts_1.LifecycleState.PREPARING;
                break;
            default:
                state = contracts_1.LifecycleState.UNKNOWN;
        }
        const labels = data.Config?.Labels || {};
        const installationId = labels[contracts_1.STUDIO_LABEL_KEYS.INSTALLATION] || 'default-studio';
        const role = (labels[contracts_1.STUDIO_LABEL_KEYS.ROLE] || 'chapter');
        let chapterId = labels[contracts_1.STUDIO_LABEL_KEYS.CHAPTER];
        if (!chapterId && name.startsWith('rag-studio-')) {
            chapterId = name.replace(/^rag-studio-/, '');
        }
        const rawGen = labels[contracts_1.STUDIO_LABEL_KEYS.GENERATION];
        const generation = rawGen ? parseInt(rawGen, 10) : undefined;
        const ports = [];
        let assignedEphemeralPort;
        const portMap = data.NetworkSettings?.Ports || {};
        for (const [containerPortProto, bindings] of Object.entries(portMap)) {
            const [cpStr, proto] = containerPortProto.split('/');
            const cp = parseInt(cpStr, 10);
            if (Array.isArray(bindings)) {
                for (const b of bindings) {
                    const hp = parseInt(b.HostPort, 10);
                    ports.push({
                        hostIp: b.HostIp,
                        hostPort: hp,
                        containerPort: cp,
                        protocol: proto || 'tcp',
                    });
                    if (cp === 8080) {
                        assignedEphemeralPort = hp;
                    }
                }
            }
        }
        return {
            id,
            name,
            state,
            rawStatus: `${status} (exit ${stateObj.ExitCode ?? 0})`,
            installationId,
            role,
            chapterId,
            generation,
            labels,
            ports,
            assignedEphemeralPort,
            ipAddress: data.NetworkSettings?.IPAddress,
            created: data.Created || '',
            startedAt: stateObj.StartedAt,
            finishedAt: stateObj.FinishedAt,
            exitCode: stateObj.ExitCode,
            oomKilled: stateObj.OOMKilled,
            healthStatus: stateObj.Health?.Status,
        };
    }
}
exports.DockerHttpAdapter = DockerHttpAdapter;
