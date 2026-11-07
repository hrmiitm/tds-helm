/**
 * Docker & Podman CLI Engine Adapter
 * Reference: upgrade.md Sections 4.1, 4.2, 4.3
 */
import { ApprovedImageRef, ContainerSpec, EngineCapabilities, EngineEvent, ImageDigest, LogChunk, NetworkRecord, OwnedNetworkSpec, OwnedVolumeSpec, RuntimeSnapshot, SafeContentArchive, VolumeRecord } from '../contracts';
import { EngineAdapter } from './engineAdapter';
export interface CliAdapterOptions {
    cliPath?: string;
    engineType?: 'docker' | 'podman';
    timeoutMs?: number;
}
export declare class DockerCliAdapter implements EngineAdapter {
    private readonly cliPath;
    private readonly engineType;
    private readonly defaultTimeoutMs;
    constructor(options?: CliAdapterOptions);
    private exec;
    probe(): Promise<EngineCapabilities>;
    listOwned(installationId: string): Promise<RuntimeSnapshot[]>;
    inspectContainer(id: string): Promise<RuntimeSnapshot | null>;
    ensureImage(ref: ApprovedImageRef): Promise<ImageDigest>;
    ensureVolume(spec: OwnedVolumeSpec): Promise<VolumeRecord>;
    createContainer(spec: ContainerSpec): Promise<string>;
    startContainer(id: string): Promise<void>;
    stopContainer(id: string, graceSeconds: number): Promise<void>;
    killContainer(id: string): Promise<void>;
    removeContainer(id: string): Promise<void>;
    removeVolume(id: string): Promise<void>;
    inspectNetwork(id: string): Promise<NetworkRecord>;
    ensureNetwork(spec: OwnedNetworkSpec): Promise<NetworkRecord>;
    removeNetwork(id: string): Promise<void>;
    copyArchive(id: string, archive: SafeContentArchive): Promise<void>;
    logs(id: string, maxBytes: number): AsyncIterable<LogChunk>;
    events(): AsyncIterable<EngineEvent>;
    private mapContainerInspection;
}
