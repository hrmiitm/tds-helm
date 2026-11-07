/**
 * Engine Adapter Interface
 * Reference: upgrade.md Section 4.1
 */

import {
  EngineCapabilities,
  RuntimeSnapshot,
  ApprovedImageRef,
  ImageDigest,
  OwnedVolumeSpec,
  VolumeRecord,
  ValidatedContainerSpec,
  NetworkRecord,
  OwnedNetworkSpec,
  SafeContentArchive,
  LogChunk,
  EngineEvent,
} from '../contracts';

export interface EngineAdapter {
  /**
   * Probe engine capabilities and feature support.
   */
  probe(): Promise<EngineCapabilities>;

  /**
   * List all containers owned by the given installationId.
   */
  listOwned(installationId: string): Promise<RuntimeSnapshot[]>;

  /**
   * Inspect container by ID or name. Returns null if not found.
   */
  inspectContainer(id: string): Promise<RuntimeSnapshot | null>;

  /**
   * Ensure image is present locally, pulling or building if allowed.
   */
  ensureImage(ref: ApprovedImageRef): Promise<ImageDigest>;

  /**
   * Ensure volume exists with required ownership labels.
   */
  ensureVolume(spec: OwnedVolumeSpec): Promise<VolumeRecord>;

  /**
   * Create a new container conforming to the validated spec.
   */
  createContainer(spec: ValidatedContainerSpec): Promise<string>;

  /**
   * Start an existing container by ID.
   */
  startContainer(id: string): Promise<void>;

  /**
   * Stop a running container with graceful timeout.
   */
  stopContainer(id: string, graceSeconds: number): Promise<void>;

  /**
   * Forcibly kill a running container.
   */
  killContainer(id: string): Promise<void>;

  /**
   * Remove a stopped container. Verifies ownership labels before deletion.
   */
  removeContainer(id: string): Promise<void>;

  /**
   * Remove a volume. Verifies ownership labels before deletion.
   */
  removeVolume(id: string): Promise<void>;

  /**
   * Inspect a network by ID or name.
   */
  inspectNetwork(id: string): Promise<NetworkRecord>;

  /**
   * Ensure a network exists with required ownership labels.
   */
  ensureNetwork(spec: OwnedNetworkSpec): Promise<NetworkRecord>;

  /**
   * Optional network removal method.
   */
  removeNetwork?(id: string): Promise<void>;

  /**
   * Copy a safe tar archive into container destination.
   */
  copyArchive(id: string, archive: SafeContentArchive): Promise<void>;

  /**
   * Stream recent container logs.
   */
  logs(id: string, maxBytes: number): AsyncIterable<LogChunk>;

  /**
   * Stream engine events.
   */
  events(): AsyncIterable<EngineEvent>;
}
