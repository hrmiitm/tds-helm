"use strict";
/**
 * Docker & Podman CLI Engine Adapter
 * Reference: upgrade.md Sections 4.1, 4.2, 4.3
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DockerCliAdapter = void 0;
const child_process_1 = require("child_process");
const stream_1 = require("stream");
const contracts_1 = require("../contracts");
const errorMapping_1 = require("./errorMapping");
class DockerCliAdapter {
    cliPath;
    engineType;
    defaultTimeoutMs;
    constructor(options = {}) {
        this.engineType = options.engineType || 'docker';
        this.cliPath = options.cliPath || (this.engineType === 'podman' ? 'podman' : 'docker');
        this.defaultTimeoutMs = options.timeoutMs ?? 30000;
    }
    async exec(args, timeoutMs, stdinStream) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.execFile)(this.cliPath, args, {
                shell: false,
                timeout: timeoutMs ?? this.defaultTimeoutMs,
                maxBuffer: 10 * 1024 * 1024,
            }, (error, stdout, stderr) => {
                if (error) {
                    reject((0, errorMapping_1.mapEngineError)(error, `CLI command failed: ${this.cliPath} ${args[0]}`));
                }
                else {
                    resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
                }
            });
            if (stdinStream && child.stdin) {
                stdinStream.pipe(child.stdin);
                stdinStream.on('error', (err) => {
                    child.kill();
                    reject((0, errorMapping_1.mapEngineError)(err, 'Failed to pipe stdin stream'));
                });
            }
        });
    }
    async probe() {
        try {
            const { stdout } = await this.exec(['info', '--format', '{{json .}}'], 15000);
            const info = JSON.parse(stdout);
            const serverVersion = String(info.ServerVersion || info.version || '0.0.0');
            const osType = String(info.OSType || process.platform);
            const arch = String(info.Architecture || process.arch);
            const cgroupVersion = String(info.CgroupVersion || (info.CgroupDriver ? 'v2' : 'v1'));
            const isRootless = !!(info.SecurityOptions?.some((opt) => opt.includes('rootless')) ||
                info.Rootless ||
                this.engineType === 'podman');
            return {
                engineType: this.engineType,
                version: serverVersion,
                apiVersion: String(info.ApiVersion || '1.45'),
                os: osType,
                arch,
                cgroupVersion,
                supportsCpuLimits: true,
                supportsMemoryLimits: true,
                supportsSwapLimits: !isRootless,
                supportsPidsLimit: true,
                supportsNoCopyMounts: this.engineType === 'docker',
                isRootless,
                endpoint: this.cliPath,
                availableMemoryBytes: typeof info.MemTotal === 'number' ? info.MemTotal : undefined,
                availableCpus: typeof info.NCPU === 'number' ? info.NCPU : undefined,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, 'Engine probe failed');
        }
    }
    async listOwned(installationId) {
        try {
            const { stdout } = await this.exec([
                'ps',
                '-a',
                '--filter',
                'name=rag-studio-',
                '--format',
                '{{.ID}}',
            ]);
            const ids = stdout
                .trim()
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            const snapshots = [];
            for (const id of ids) {
                const snap = await this.inspectContainer(id);
                if (snap) {
                    snapshots.push(snap);
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
            const { stdout } = await this.exec(['inspect', '--type', 'container', id]);
            const parsed = JSON.parse(stdout);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                return null;
            }
            return this.mapContainerInspection(parsed[0]);
        }
        catch (err) {
            const mapped = (0, errorMapping_1.mapEngineError)(err);
            if (mapped.message.includes('No such container') ||
                mapped.message.includes('not found') ||
                mapped.code === contracts_1.StudioErrorCode.NAME_CONFLICT) {
                return null;
            }
            throw mapped;
        }
    }
    async ensureImage(ref) {
        try {
            // Check if image exists locally
            const { stdout } = await this.exec(['image', 'inspect', ref.image]);
            const parsed = JSON.parse(stdout);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const img = parsed[0];
                return {
                    id: img.Id,
                    digest: img.RepoDigests?.[0] || img.Id,
                    repoTags: img.RepoTags,
                };
            }
        }
        catch {
            // Not found locally; pull image
        }
        try {
            await this.exec(['pull', ref.image], 180000);
            const { stdout } = await this.exec(['image', 'inspect', ref.image]);
            const img = JSON.parse(stdout)[0];
            return {
                id: img.Id,
                digest: img.RepoDigests?.[0] || img.Id,
                repoTags: img.RepoTags,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to ensure image: ${ref.image}`);
        }
    }
    async ensureVolume(spec) {
        try {
            // Check if volume already exists
            const { stdout } = await this.exec(['volume', 'inspect', spec.name]);
            const parsed = JSON.parse(stdout);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const vol = parsed[0];
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
            // Not found, proceed to create
        }
        try {
            const args = [
                'volume',
                'create',
                '--label',
                `${contracts_1.STUDIO_LABEL_KEYS.MANAGED}=true`,
                '--label',
                `${contracts_1.STUDIO_LABEL_KEYS.INSTALLATION}=${spec.installationId}`,
                '--label',
                `${contracts_1.STUDIO_LABEL_KEYS.ROLE}=${spec.role}`,
            ];
            if (spec.chapterId) {
                args.push('--label', `${contracts_1.STUDIO_LABEL_KEYS.CHAPTER}=${spec.chapterId}`);
            }
            if (spec.labels) {
                for (const [k, v] of Object.entries(spec.labels)) {
                    args.push('--label', `${k}=${v}`);
                }
            }
            if (spec.driver) {
                args.push('--driver', spec.driver);
            }
            args.push(spec.name);
            await this.exec(args);
            const { stdout } = await this.exec(['volume', 'inspect', spec.name]);
            const vol = JSON.parse(stdout)[0];
            return {
                name: vol.Name,
                driver: vol.Driver || 'local',
                labels: vol.Labels || {},
                mountpoint: vol.Mountpoint,
                created: vol.CreatedAt,
            };
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to create volume: ${spec.name}`);
        }
    }
    async createContainer(spec) {
        const limits = (0, contracts_1.validateResourceCeilings)(spec.resources);
        const args = ['create', '--name', spec.name];
        // Ownership labels
        args.push('--label', `${contracts_1.STUDIO_LABEL_KEYS.MANAGED}=true`);
        args.push('--label', `${contracts_1.STUDIO_LABEL_KEYS.INSTALLATION}=${spec.installationId}`);
        args.push('--label', `${contracts_1.STUDIO_LABEL_KEYS.ROLE}=${spec.role}`);
        args.push('--label', `${contracts_1.STUDIO_LABEL_KEYS.CHAPTER}=${spec.chapterId}`);
        args.push('--label', `${contracts_1.STUDIO_LABEL_KEYS.GENERATION}=${spec.generation}`);
        if (spec.labels) {
            for (const [k, v] of Object.entries(spec.labels)) {
                if (!k.startsWith('io.studio.')) {
                    args.push('--label', `${k}=${v}`);
                }
            }
        }
        // Resources enforcement
        const cpus = limits.cpuMilli / 1000;
        args.push(`--cpus=${cpus}`);
        args.push(`--memory=${limits.memoryBytes}b`);
        if (limits.pidsLimit) {
            args.push(`--pids-limit=${limits.pidsLimit}`);
        }
        // Security & Process options
        args.push('--init');
        if (spec.user) {
            args.push('--user', spec.user);
        }
        if (spec.readOnlyRootFilesystem) {
            args.push('--read-only');
        }
        // Stop timeout
        const stopGrace = spec.stopGraceSeconds ?? contracts_1.RESOURCE_CEILINGS.DEFAULT_STOP_GRACE_SECONDS;
        args.push(`--stop-timeout=${stopGrace}`);
        // Restart policy strictly 'no'
        args.push('--restart=no');
        // Environment variables
        if (spec.env) {
            for (const [k, v] of Object.entries(spec.env)) {
                args.push('-e', `${k}=${v}`);
            }
        }
        // Volumes
        for (const v of spec.volumes) {
            const mode = v.readOnly ? 'ro' : 'rw';
            args.push('-v', `${v.source}:${v.target}:${mode}`);
        }
        // Port bindings
        if (spec.portBindings) {
            for (const p of spec.portBindings) {
                const hostIp = p.hostIp || '127.0.0.1';
                const hostPort = p.hostPort !== undefined ? p.hostPort : 0;
                args.push('-p', `${hostIp}:${hostPort}:${p.containerPort}`);
            }
        }
        // Network
        if (spec.network) {
            args.push('--network', spec.network);
        }
        if (spec.networkAliases) {
            for (const alias of spec.networkAliases) {
                args.push('--network-alias', alias);
            }
        }
        args.push(spec.image);
        if (spec.command && spec.command.length > 0) {
            args.push(...spec.command);
        }
        try {
            const { stdout } = await this.exec(args);
            return stdout.trim();
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to create container ${spec.name}`);
        }
    }
    async startContainer(id) {
        try {
            await this.exec(['start', id]);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to start container ${id}`);
        }
    }
    async stopContainer(id, graceSeconds) {
        try {
            await this.exec(['stop', '-t', String(graceSeconds), id], (graceSeconds + 10) * 1000);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to stop container ${id}`);
        }
    }
    async killContainer(id) {
        try {
            await this.exec(['kill', id]);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to kill container ${id}`);
        }
    }
    async removeContainer(id) {
        // Label check before deletion
        const snap = await this.inspectContainer(id);
        if (!snap) {
            return; // Already absent
        }
        if (!(0, contracts_1.isManagedByStudio)(snap.labels, snap.name)) {
            throw new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Refusing to delete container ${id}: object is not managed by Studio Universal`);
        }
        try {
            await this.exec(['rm', '-f', id]);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to remove container ${id}`);
        }
    }
    async removeVolume(id) {
        try {
            const { stdout } = await this.exec(['volume', 'inspect', id]);
            const parsed = JSON.parse(stdout);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const labels = parsed[0].Labels || {};
                if (!(0, contracts_1.isManagedByStudio)(labels, id)) {
                    throw new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Refusing to delete volume ${id}: object is not managed by Studio Universal`);
                }
            }
        }
        catch (err) {
            if (err instanceof contracts_1.EngineError) {
                throw err;
            }
            return; // Volume already removed
        }
        try {
            await this.exec(['volume', 'rm', '-f', id]);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to remove volume ${id}`);
        }
    }
    async inspectNetwork(id) {
        try {
            const { stdout } = await this.exec(['network', 'inspect', id]);
            const parsed = JSON.parse(stdout);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Network not found: ${id}`);
            }
            const net = parsed[0];
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
            // Does not exist, create
        }
        try {
            const args = [
                'network',
                'create',
                '--label',
                `${contracts_1.STUDIO_LABEL_KEYS.MANAGED}=true`,
                '--label',
                `${contracts_1.STUDIO_LABEL_KEYS.INSTALLATION}=${spec.installationId}`,
                '--label',
                `${contracts_1.STUDIO_LABEL_KEYS.ROLE}=${spec.role}`,
            ];
            if (spec.internal) {
                args.push('--internal');
            }
            if (spec.labels) {
                for (const [k, v] of Object.entries(spec.labels)) {
                    args.push('--label', `${k}=${v}`);
                }
            }
            args.push(spec.name);
            await this.exec(args);
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
            await this.exec(['network', 'rm', id]);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to remove network ${id}`);
        }
    }
    async copyArchive(id, archive) {
        try {
            const readable = Buffer.isBuffer(archive.content)
                ? stream_1.Readable.from(archive.content)
                : archive.content;
            await this.exec(['cp', '-', `${id}:${archive.destinationPath}`], 60000, readable);
        }
        catch (err) {
            throw (0, errorMapping_1.mapEngineError)(err, `Failed to copy archive to container ${id}`);
        }
    }
    async *logs(id, maxBytes) {
        const { stdout, stderr } = await this.exec(['logs', '--tail', '500', id]);
        if (stdout) {
            const truncated = stdout.slice(-maxBytes);
            yield { stream: 'stdout', data: truncated };
        }
        if (stderr) {
            const truncated = stderr.slice(-maxBytes);
            yield { stream: 'stderr', data: truncated };
        }
    }
    async *events() {
        const child = (0, child_process_1.spawn)(this.cliPath, ['events', '--format', '{{json .}}'], {
            shell: false,
        });
        try {
            for await (const chunk of child.stdout) {
                const lines = chunk.toString().split(/\r?\n/);
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
                        // ignore partial json
                    }
                }
            }
        }
        finally {
            child.kill();
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
exports.DockerCliAdapter = DockerCliAdapter;
