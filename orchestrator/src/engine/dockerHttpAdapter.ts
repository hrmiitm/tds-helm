/**
 * Docker & Podman Engine HTTP API Adapter
 * Reference: upgrade.md Sections 4.1, 4.2, 4.3, 4.4
 */

import * as http from 'http';
import { Readable } from 'stream';
import {
  ApprovedImageRef,
  ContainerSpec,
  EngineCapabilities,
  EngineEvent,
  ImageDigest,
  LifecycleState,
  LogChunk,
  NetworkRecord,
  OwnedNetworkSpec,
  OwnedVolumeSpec,
  PortMapping,
  RESOURCE_CEILINGS,
  RuntimeSnapshot,
  SafeContentArchive,
  StudioErrorCode,
  STUDIO_LABEL_KEYS,
  StudioRole,
  validateResourceCeilings,
  VolumeRecord,
  isManagedByStudio,
  EngineError,
} from '../contracts';
import { EngineAdapter } from './engineAdapter';
import { mapEngineError } from './errorMapping';
import { normalizeEndpoint } from './engineDiscovery';

export interface HttpAdapterOptions {
  socketPath?: string;
  host?: string;
  port?: number;
  engineType?: 'docker' | 'podman';
  timeoutMs?: number;
}

export class DockerHttpAdapter implements EngineAdapter {
  private readonly socketPath?: string;
  private readonly host?: string;
  private readonly port?: number;
  private readonly engineType: 'docker' | 'podman';
  private readonly defaultTimeoutMs: number;

  constructor(options: HttpAdapterOptions = {}) {
    this.engineType = options.engineType || 'docker';
    this.defaultTimeoutMs = options.timeoutMs ?? 30000;

    if (options.host) {
      this.host = options.host;
      this.port = options.port || (this.engineType === 'podman' ? 8888 : 2375);
    } else {
      const ep = options.socketPath || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock');
      this.socketPath = normalizeEndpoint(ep);
    }
  }

  private request(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs?: number,
    headers?: Record<string, string>
  ): Promise<{ statusCode: number; data: Buffer; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const isBuffer = Buffer.isBuffer(body);
      const isStream = body instanceof Readable;
      const jsonBody = !isBuffer && !isStream && body !== undefined ? JSON.stringify(body) : undefined;

      const reqHeaders: Record<string, string> = {
        Host: 'docker.local',
        ...headers,
      };

      if (jsonBody) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(jsonBody));
      } else if (isBuffer) {
        reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/x-tar';
        reqHeaders['Content-Length'] = String((body as Buffer).length);
      }

      const reqOptions: http.RequestOptions = {
        method,
        path,
        headers: reqHeaders,
        timeout: timeoutMs ?? this.defaultTimeoutMs,
      };

      if (this.socketPath) {
        reqOptions.socketPath = this.socketPath;
      } else {
        reqOptions.host = this.host;
        reqOptions.port = this.port;
      }

      const req = http.request(reqOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
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
        reject(
          new EngineError(
            StudioErrorCode.READINESS_TIMEOUT,
            `Engine HTTP request timed out after ${timeoutMs ?? this.defaultTimeoutMs}ms on ${method} ${path}`
          )
        );
      });

      req.on('error', (err) => {
        reject(mapEngineError(err, `HTTP request failed on ${method} ${path}`));
      });

      if (jsonBody) {
        req.write(jsonBody);
        req.end();
      } else if (isBuffer) {
        req.write(body);
        req.end();
      } else if (isStream) {
        (body as Readable).pipe(req);
      } else {
        req.end();
      }
    });
  }

  public async probe(): Promise<EngineCapabilities> {
    try {
      const [verRes, infoRes] = await Promise.all([
        this.request('GET', '/version', undefined, 10000),
        this.request('GET', '/info', undefined, 10000),
      ]);

      if (verRes.statusCode >= 400 || infoRes.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Engine probe HTTP failed with status ${verRes.statusCode} / ${infoRes.statusCode}`
        );
      }

      const ver = JSON.parse(verRes.data.toString('utf8'));
      const info = JSON.parse(infoRes.data.toString('utf8'));

      const serverVersion = String(ver.Version || info.ServerVersion || '0.0.0');
      const apiVersion = String(ver.ApiVersion || '1.45');
      const osType = String(ver.Os || info.OSType || process.platform);
      const arch = String(ver.Arch || info.Architecture || process.arch);
      const cgroupVersion = String(info.CgroupVersion || (info.CgroupDriver ? 'v2' : 'v1'));
      const isRootless = !!(
        info.SecurityOptions?.some((opt: string) => opt.includes('rootless')) ||
        info.Rootless ||
        this.engineType === 'podman'
      );

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
    } catch (err) {
      throw mapEngineError(err, 'Engine probe HTTP failed');
    }
  }

  public async listOwned(installationId: string): Promise<RuntimeSnapshot[]> {
    try {
      const res = await this.request('GET', '/containers/json?all=1');

      if (res.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to list containers: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }

      const list: any[] = JSON.parse(res.data.toString('utf8'));
      const snapshots: RuntimeSnapshot[] = [];

      for (const item of list) {
        const names: string[] = item.Names || [];
        const isStudioName = names.some((n: string) => n.includes('rag-studio'));
        const labels = item.Labels || {};
        const isStudioLabel = isManagedByStudio(labels);

        if (isStudioName || isStudioLabel) {
          const snap = await this.inspectContainer(item.Id);
          if (snap) {
            snapshots.push(snap);
          }
        }
      }

      return snapshots;
    } catch (err) {
      throw mapEngineError(err, `Failed to list owned containers for installation ${installationId}`);
    }
  }

  public async inspectContainer(id: string): Promise<RuntimeSnapshot | null> {
    try {
      const res = await this.request('GET', `/containers/${encodeURIComponent(id)}/json`);
      if (res.statusCode === 404) {
        return null;
      }
      if (res.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to inspect container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }

      const data = JSON.parse(res.data.toString('utf8'));
      return this.mapContainerInspection(data);
    } catch (err) {
      const mapped = mapEngineError(err);
      if (mapped.code === StudioErrorCode.NAME_CONFLICT || mapped.message.includes('not found')) {
        return null;
      }
      throw mapped;
    }
  }

  public async ensureImage(ref: ApprovedImageRef): Promise<ImageDigest> {
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
    } catch {
      // Not found locally
    }

    try {
      // Pull image
      const pullRes = await this.request(
        'POST',
        `/images/create?fromImage=${encodeURIComponent(ref.image)}`,
        undefined,
        180000
      );

      if (pullRes.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.IMAGE_UNAVAILABLE,
          `Failed to pull image ${ref.image}: HTTP ${pullRes.statusCode} ${pullRes.data.toString('utf8')}`
        );
      }

      const inspectRes = await this.request('GET', `/images/${encodeURIComponent(ref.image)}/json`);
      const data = JSON.parse(inspectRes.data.toString('utf8'));
      return {
        id: data.Id,
        digest: data.RepoDigests?.[0] || data.Id,
        repoTags: data.RepoTags,
      };
    } catch (err) {
      throw mapEngineError(err, `Failed to ensure image: ${ref.image}`);
    }
  }

  public async ensureVolume(spec: OwnedVolumeSpec): Promise<VolumeRecord> {
    try {
      // Check existing
      const inspectRes = await this.request('GET', `/volumes/${encodeURIComponent(spec.name)}`);
      if (inspectRes.statusCode === 200) {
        const vol = JSON.parse(inspectRes.data.toString('utf8'));
        const labels = vol.Labels || {};
        if (!isManagedByStudio(labels, spec.name)) {
          throw new EngineError(
            StudioErrorCode.NAME_CONFLICT,
            `Volume ${spec.name} exists but is not managed by Studio Universal`
          );
        }
        if (labels[STUDIO_LABEL_KEYS.INSTALLATION] && labels[STUDIO_LABEL_KEYS.INSTALLATION] !== spec.installationId) {
          throw new EngineError(
            StudioErrorCode.PERMISSION_DENIED,
            `Volume ${spec.name} is owned by another installation`
          );
        }
        return {
          name: vol.Name,
          driver: vol.Driver || 'local',
          labels,
          mountpoint: vol.Mountpoint,
          created: vol.CreatedAt,
        };
      }
    } catch (err) {
      if (err instanceof EngineError && err.code !== StudioErrorCode.ENGINE_UNAVAILABLE) {
        throw err;
      }
    }

    try {
      const labels: Record<string, string> = {
        [STUDIO_LABEL_KEYS.MANAGED]: 'true',
        [STUDIO_LABEL_KEYS.INSTALLATION]: spec.installationId,
        [STUDIO_LABEL_KEYS.ROLE]: spec.role,
        ...(spec.chapterId ? { [STUDIO_LABEL_KEYS.CHAPTER]: spec.chapterId } : {}),
        ...(spec.labels || {}),
      };

      const body = {
        Name: spec.name,
        Driver: spec.driver || 'local',
        Labels: labels,
      };

      const res = await this.request('POST', '/volumes/create', body);
      if (res.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to create volume ${spec.name}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }

      const vol = JSON.parse(res.data.toString('utf8'));
      return {
        name: vol.Name,
        driver: vol.Driver || 'local',
        labels: vol.Labels || labels,
        mountpoint: vol.Mountpoint,
        created: vol.CreatedAt,
      };
    } catch (err) {
      throw mapEngineError(err, `Failed to ensure volume ${spec.name}`);
    }
  }

  public async createContainer(spec: ContainerSpec): Promise<string> {
    const limits = validateResourceCeilings(spec.resources);

    const labels: Record<string, string> = {
      [STUDIO_LABEL_KEYS.MANAGED]: 'true',
      [STUDIO_LABEL_KEYS.INSTALLATION]: spec.installationId,
      [STUDIO_LABEL_KEYS.ROLE]: spec.role,
      [STUDIO_LABEL_KEYS.CHAPTER]: spec.chapterId,
      [STUDIO_LABEL_KEYS.GENERATION]: String(spec.generation),
      ...(spec.labels || {}),
    };

    const envArray: string[] = [];
    if (spec.env) {
      for (const [k, v] of Object.entries(spec.env)) {
        envArray.push(`${k}=${v}`);
      }
    }

    const binds: string[] = spec.volumes.map((v) => `${v.source}:${v.target}:${v.readOnly ? 'ro' : 'rw'}`);

    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>> = {};

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

    const stopGrace = spec.stopGraceSeconds ?? RESOURCE_CEILINGS.DEFAULT_STOP_GRACE_SECONDS;

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
      const res = await this.request(
        'POST',
        `/containers/create?name=${encodeURIComponent(spec.name)}`,
        createBody
      );

      if (res.statusCode >= 400) {
        throw new EngineError(
          res.statusCode === 409 ? StudioErrorCode.NAME_CONFLICT : StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to create container ${spec.name}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`,
          { details: { statusCode: res.statusCode, body: res.data.toString('utf8') } }
        );
      }

      const parsed = JSON.parse(res.data.toString('utf8'));
      return parsed.Id;
    } catch (err) {
      throw mapEngineError(err, `Failed to create container ${spec.name}`);
    }
  }

  public async startContainer(id: string): Promise<void> {
    try {
      const res = await this.request('POST', `/containers/${encodeURIComponent(id)}/start`);
      if (res.statusCode >= 400 && res.statusCode !== 304) {
        throw new EngineError(
          res.statusCode === 409 ? StudioErrorCode.PORT_IN_USE : StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to start container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to start container ${id}`);
    }
  }

  public async stopContainer(id: string, graceSeconds: number): Promise<void> {
    try {
      const res = await this.request(
        'POST',
        `/containers/${encodeURIComponent(id)}/stop?t=${graceSeconds}`,
        undefined,
        (graceSeconds + 10) * 1000
      );
      if (res.statusCode >= 400 && res.statusCode !== 304) {
        throw new EngineError(
          StudioErrorCode.STOP_FAILED,
          `Failed to stop container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to stop container ${id}`);
    }
  }

  public async killContainer(id: string): Promise<void> {
    try {
      const res = await this.request('POST', `/containers/${encodeURIComponent(id)}/kill`);
      if (res.statusCode >= 400 && res.statusCode !== 304) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to kill container ${id}: HTTP ${res.statusCode}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to kill container ${id}`);
    }
  }

  public async removeContainer(id: string): Promise<void> {
    const snap = await this.inspectContainer(id);
    if (!snap) {
      return; // Already deleted
    }

    if (!isManagedByStudio(snap.labels, snap.name)) {
      throw new EngineError(
        StudioErrorCode.PERMISSION_DENIED,
        `Refusing to delete container ${id}: object is not managed by Studio Universal`
      );
    }

    try {
      const res = await this.request('DELETE', `/containers/${encodeURIComponent(id)}?force=true`);
      if (res.statusCode >= 400 && res.statusCode !== 404) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to remove container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to remove container ${id}`);
    }
  }

  public async removeVolume(id: string): Promise<void> {
    try {
      const inspectRes = await this.request('GET', `/volumes/${encodeURIComponent(id)}`);
      if (inspectRes.statusCode === 200) {
        const vol = JSON.parse(inspectRes.data.toString('utf8'));
        if (!isManagedByStudio(vol.Labels, id)) {
          throw new EngineError(
            StudioErrorCode.PERMISSION_DENIED,
            `Refusing to delete volume ${id}: object is not managed by Studio Universal`
          );
        }
      } else if (inspectRes.statusCode === 404) {
        return; // Already absent
      }
    } catch (err) {
      if (err instanceof EngineError) throw err;
      return;
    }

    try {
      const res = await this.request('DELETE', `/volumes/${encodeURIComponent(id)}?force=true`);
      if (res.statusCode >= 400 && res.statusCode !== 404) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to remove volume ${id}: HTTP ${res.statusCode}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to remove volume ${id}`);
    }
  }

  public async inspectNetwork(id: string): Promise<NetworkRecord> {
    try {
      const res = await this.request('GET', `/networks/${encodeURIComponent(id)}`);
      if (res.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Network not found: ${id} (HTTP ${res.statusCode})`
        );
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
    } catch (err) {
      throw mapEngineError(err, `Failed to inspect network ${id}`);
    }
  }

  public async ensureNetwork(spec: OwnedNetworkSpec): Promise<NetworkRecord> {
    try {
      return await this.inspectNetwork(spec.name);
    } catch {
      // Network does not exist, create it
    }

    try {
      const labels: Record<string, string> = {
        [STUDIO_LABEL_KEYS.MANAGED]: 'true',
        [STUDIO_LABEL_KEYS.INSTALLATION]: spec.installationId,
        [STUDIO_LABEL_KEYS.ROLE]: spec.role,
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
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to create network ${spec.name}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }

      return await this.inspectNetwork(spec.name);
    } catch (err) {
      throw mapEngineError(err, `Failed to ensure network ${spec.name}`);
    }
  }

  public async removeNetwork(id: string): Promise<void> {
    try {
      const net = await this.inspectNetwork(id);
      if (!isManagedByStudio(net.labels)) {
        throw new EngineError(
          StudioErrorCode.PERMISSION_DENIED,
          `Refusing to delete network ${id}: object is not managed by Studio Universal`
        );
      }

      const res = await this.request('DELETE', `/networks/${encodeURIComponent(id)}`);
      if (res.statusCode >= 400 && res.statusCode !== 404) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to remove network ${id}: HTTP ${res.statusCode}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to remove network ${id}`);
    }
  }

  public async copyArchive(id: string, archive: SafeContentArchive): Promise<void> {
    try {
      const res = await this.request(
        'PUT',
        `/containers/${encodeURIComponent(id)}/archive?path=${encodeURIComponent(archive.destinationPath)}`,
        archive.content,
        60000,
        { 'Content-Type': 'application/x-tar' }
      );

      if (res.statusCode >= 400) {
        throw new EngineError(
          StudioErrorCode.ENGINE_UNAVAILABLE,
          `Failed to copy archive to container ${id}: HTTP ${res.statusCode} ${res.data.toString('utf8')}`
        );
      }
    } catch (err) {
      throw mapEngineError(err, `Failed to copy archive to container ${id}`);
    }
  }

  public async *logs(id: string, maxBytes: number): AsyncIterable<LogChunk> {
    const res = await this.request(
      'GET',
      `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&tail=500`
    );

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

  public async *events(): AsyncIterable<EngineEvent> {
    // Basic event polling or connection
    const res = await this.request('GET', '/events?since=0');
    if (res.statusCode === 200) {
      const lines = res.data.toString('utf8').split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
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
        } catch {
          // ignore malformed line
        }
      }
    }
  }

  private mapContainerInspection(data: Record<string, any>): RuntimeSnapshot {
    const id = data.Id || '';
    const name = String(data.Name || '').replace(/^\//, '');
    const stateObj = data.State || {};
    const status = String(stateObj.Status || 'unknown').toLowerCase();

    let state: LifecycleState;
    switch (status) {
      case 'running':
        state = LifecycleState.RUNNING;
        break;
      case 'exited':
      case 'dead':
        state = LifecycleState.STOPPED;
        break;
      case 'paused':
      case 'restarting':
        state = LifecycleState.STARTING;
        break;
      case 'created':
        state = LifecycleState.PREPARING;
        break;
      default:
        state = LifecycleState.UNKNOWN;
    }

    const labels: Record<string, string> = data.Config?.Labels || {};
    const installationId = labels[STUDIO_LABEL_KEYS.INSTALLATION] || 'default-studio';
    const role = (labels[STUDIO_LABEL_KEYS.ROLE] || 'chapter') as StudioRole;
    let chapterId = labels[STUDIO_LABEL_KEYS.CHAPTER];
    if (!chapterId && name.startsWith('rag-studio-')) {
      chapterId = name.replace(/^rag-studio-/, '');
    }
    const rawGen = labels[STUDIO_LABEL_KEYS.GENERATION];
    const generation = rawGen ? parseInt(rawGen, 10) : undefined;

    const ports: PortMapping[] = [];
    let assignedEphemeralPort: number | undefined;

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
            protocol: (proto as 'tcp' | 'udp') || 'tcp',
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
