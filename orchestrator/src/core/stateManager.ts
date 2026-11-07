/**
 * Studio Universal Orchestrator - Lifecycle State Machine & Chapter Orchestrator
 * Reference: upgrade.md Sections 2.1, 2.2, 3.1-3.3, 4.2-4.4
 */

import * as http from 'http';
import * as net from 'net';
import { randomUUID } from 'crypto';
import {
  LifecycleState,
  Chapter,
  RuntimeSnapshot,
  ContainerSpec,
  ResetToken,
  RESOURCE_CEILINGS,
  STUDIO_LABEL_KEYS,
  StudioErrorCode,
} from '../contracts/types';
import { EngineError } from '../contracts/errors';
import { EngineAdapter } from '../engine/engineAdapter';
import { OperationManager } from './operations';

export interface StateManagerOptions {
  installationId: string;
  engine: EngineAdapter;
  operations: OperationManager;
  defaultImage?: string;
  networkName?: string;
}

export class StateManager {
  private installationId: string;
  private engine: EngineAdapter;
  private operations: OperationManager;
  private defaultImage: string;
  private networkName: string;

  private chapterStates: Map<string, LifecycleState> = new Map();
  private chapterGenerations: Map<string, number> = new Map();
  private chapterPortMap: Map<string, number> = new Map();
  private activeChapterId: string | null = null;
  private activeGeneration = 1;
  private activeSnapshot: RuntimeSnapshot | null = null;

  private resetTokens: Map<string, ResetToken> = new Map();
  private revision = 1;

  constructor(opts: StateManagerOptions) {
    this.installationId = opts.installationId;
    this.engine = opts.engine;
    this.operations = opts.operations;
    this.defaultImage = opts.defaultImage || 'rag-studio:4.2.0';
    this.networkName = opts.networkName || 'rag-studio-net';
  }

  public getRevision(): number {
    return this.revision;
  }

  public getActiveChapterId(): string | null {
    return this.activeChapterId;
  }

  public getActiveGeneration(): number {
    return this.activeGeneration;
  }

  public getActiveSnapshot(): RuntimeSnapshot | null {
    return this.activeSnapshot;
  }

  public getChapterState(chapterId: string): LifecycleState {
    return this.chapterStates.get(chapterId) || LifecycleState.NOT_STARTED;
  }

  public getActivePort(): number | null {
    if (!this.activeChapterId) return null;
    return this.chapterPortMap.get(this.activeChapterId) || null;
  }

  /**
   * Reconciles observed engine state with in-memory state.
   */
  public async reconcile(): Promise<void> {
    try {
      const owned = await this.engine.listOwned(this.installationId);
      let foundRunning: RuntimeSnapshot | null = null;

      for (const snap of owned) {
        if (snap.chapterId) {
          this.chapterStates.set(snap.chapterId, snap.state);
          if (snap.assignedEphemeralPort) {
            this.chapterPortMap.set(snap.chapterId, snap.assignedEphemeralPort);
          }
          if (snap.generation) {
            this.chapterGenerations.set(snap.chapterId, snap.generation);
          }

          if (snap.state === LifecycleState.RUNNING || snap.state === LifecycleState.STARTING) {
            if (!foundRunning) {
              foundRunning = snap;
            } else {
              // Invariant violation: multiple containers running. Stop superfluous ones!
              console.warn(`[RECONCILE] Invariant violation: multiple containers running. Stopping ${snap.name}...`);
              await this.engine.stopContainer(snap.id, 5);
              this.chapterStates.set(snap.chapterId, LifecycleState.STOPPED);
            }
          }
        }
      }

      if (foundRunning && foundRunning.chapterId) {
        this.activeChapterId = foundRunning.chapterId;
        this.activeGeneration = foundRunning.generation || 1;
        this.activeSnapshot = foundRunning;
      } else {
        this.activeChapterId = null;
        this.activeSnapshot = null;
      }

      this.revision++;
    } catch (err) {
      console.error('[RECONCILE] Engine reconciliation failed:', err);
    }
  }

  /**
   * Launches or resumes a chapter runtime container.
   * Strictly enforces the single-active chapter policy.
   */
  public async launchChapter(chapter: Chapter, idempotencyKey?: string): Promise<{
    operationId: string;
    chapterId: string;
    generation: number;
    port: number;
    sessionUrl: string;
  }> {
    const chapterId = chapter.id;
    const op = this.operations.acquireOperationLock({
      type: 'launch',
      chapterId,
      idempotencyKey,
      targetRevision: this.revision + 1,
    });

    try {
      this.operations.updatePhase(op.operationId, 'PREPARING', { chapterId });
      this.chapterStates.set(chapterId, LifecycleState.PREPARING);

      // Step 1: Enforce single-active rule — if another chapter is running, stop it first!
      if (this.activeChapterId && this.activeChapterId !== chapterId) {
        const previousId = this.activeChapterId;
        this.operations.updatePhase(op.operationId, 'STOPPING_PREVIOUS', { previousChapterId: previousId });
        await this.stopChapterInternal(previousId, 15);
      }

      // Step 2: Ensure dedicated volumes
      this.operations.updatePhase(op.operationId, 'PREPARING_VOLUMES', { chapterId });
      const workspaceVolName = `rag-workspace-${chapterId}`;
      const userVolName = `rag-user-${chapterId}`;

      await this.engine.ensureVolume({
        name: workspaceVolName,
        installationId: this.installationId,
        role: 'chapter',
        chapterId,
      });

      await this.engine.ensureVolume({
        name: userVolName,
        installationId: this.installationId,
        role: 'chapter',
        chapterId,
      });

      // Step 3: Inspect existing container
      const containerName = `rag-studio-${chapterId}`;
      const inspectRes = await this.engine.inspectContainer(containerName);

      // Fast-path resume: If container is already running and responsive, reuse it immediately!
      if (inspectRes && inspectRes.state === LifecycleState.RUNNING && inspectRes.assignedEphemeralPort) {
        const isHealthy = await this.isPortHealthy(inspectRes.assignedEphemeralPort, 1500);
        if (isHealthy) {
          const hostPort = inspectRes.assignedEphemeralPort;
          this.chapterPortMap.set(chapterId, hostPort);
          const gen = inspectRes.generation || (this.chapterGenerations.get(chapterId) || 1);
          this.chapterGenerations.set(chapterId, gen);
          this.activeGeneration = gen;
          this.activeChapterId = chapterId;
          this.activeSnapshot = inspectRes;
          this.chapterStates.set(chapterId, LifecycleState.RUNNING);
          this.revision++;

          const sessionUrl = `/s/${chapterId}/${gen}/`;
          this.operations.succeedOperation(op.operationId, {
            chapterId,
            generation: gen,
            hostPort,
            sessionUrl,
          });

          return {
            operationId: op.operationId,
            chapterId,
            generation: gen,
            port: hostPort,
            sessionUrl,
          };
        }
      }

      // If existing container is present (stopped or unresponsive), cleanly remove it
      if (inspectRes) {
        this.operations.updatePhase(op.operationId, 'CLEANING_STALE_CONTAINER', { containerId: inspectRes.id });
        try {
          if (inspectRes.state === LifecycleState.RUNNING || inspectRes.state === LifecycleState.STARTING) {
            await this.engine.stopContainer(inspectRes.id, 2);
          }
          await this.engine.removeContainer(inspectRes.id);
        } catch (cleanErr) {
          console.warn(`[LAUNCH] Old container cleanup notice:`, cleanErr);
        }
      }

      // Step 4: Allocate ephemeral host port for container
      const hostPort = await this.allocateFreePort();
      this.chapterPortMap.set(chapterId, hostPort);

      // Increment generation
      const gen = (this.chapterGenerations.get(chapterId) || 0) + 1;
      this.chapterGenerations.set(chapterId, gen);
      this.activeGeneration = gen;

      // Step 5: Create and start fresh container
      this.operations.updatePhase(op.operationId, 'STARTING_CONTAINER', { containerName, hostPort });
      this.chapterStates.set(chapterId, LifecycleState.STARTING);

      const containerId = await this.createChapterContainer(chapter, hostPort, gen);
      await this.engine.startContainer(containerId);

      // Step 6: Wait for readiness probe with periodic progress updates
      this.operations.updatePhase(op.operationId, 'WAITING_FOR_SERVICES', { hostPort, timeoutSeconds: 45 });
      await this.pollReadiness(hostPort, 45000, (elapsedSec) => {
        this.operations.updatePhase(op.operationId, 'WAITING_FOR_SERVICES', {
          hostPort,
          elapsedSeconds: elapsedSec,
          message: `Starting services: VS Code, JupyterLab, ChromaDB... (${elapsedSec}s)`,
        });
      });

      // Step 7: Mark ready and commit active route
      this.activeChapterId = chapterId;
      this.chapterStates.set(chapterId, LifecycleState.RUNNING);
      this.revision++;

      const sessionUrl = `/s/${chapterId}/${gen}/`;
      this.operations.succeedOperation(op.operationId, {
        chapterId,
        generation: gen,
        hostPort,
        sessionUrl,
      });

      return {
        operationId: op.operationId,
        chapterId,
        generation: gen,
        port: hostPort,
        sessionUrl,
      };
    } catch (err: unknown) {
      this.chapterStates.set(chapterId, LifecycleState.ERROR);
      this.operations.failOperation(op.operationId, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  /**
   * Stops an active chapter container.
   */
  public async stopChapter(chapterId: string, graceSeconds = 5): Promise<void> {
    const op = this.operations.acquireOperationLock({
      type: 'stop',
      chapterId,
      targetRevision: this.revision + 1,
    });

    try {
      this.operations.updatePhase(op.operationId, 'STOPPING', { chapterId, graceSeconds });
      await this.stopChapterInternal(chapterId, graceSeconds);
      this.operations.succeedOperation(op.operationId, { chapterId, state: LifecycleState.STOPPED });
    } catch (err: unknown) {
      this.operations.failOperation(op.operationId, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  private async stopChapterInternal(chapterId: string, graceSeconds = 5): Promise<void> {
    this.chapterStates.set(chapterId, LifecycleState.STOPPING);
    const containerName = `rag-studio-${chapterId}`;

    const snap = await this.engine.inspectContainer(containerName);
    if (snap && (snap.state === LifecycleState.RUNNING || snap.state === LifecycleState.STARTING)) {
      await this.engine.stopContainer(snap.id, graceSeconds);
    }

    this.chapterStates.set(chapterId, LifecycleState.STOPPED);
    if (this.activeChapterId === chapterId) {
      this.activeChapterId = null;
      this.activeSnapshot = null;
    }
    this.revision++;
  }

  /**
   * Issues a signed ResetToken requiring explicit confirmation before data destruction.
   */
  public prepareResetConfirmation(chapterId: string): ResetToken {
    const tokenStr = randomUUID();
    const token: ResetToken = {
      token: tokenStr,
      installationId: this.installationId,
      chapterId,
      epoch: Date.now(),
      volumeIds: [`rag-workspace-${chapterId}`, `rag-user-${chapterId}`],
      resetScope: 'workspace_and_home',
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
      used: false,
    };
    this.resetTokens.set(tokenStr, token);
    return token;
  }

  /**
   * Executes a confirmed factory reset on a chapter.
   */
  public async executeReset(tokenStr: string): Promise<void> {
    const token = this.resetTokens.get(tokenStr);
    if (!token) {
      throw new EngineError(StudioErrorCode.STALE_REVISION, 'Invalid or unknown reset confirmation token.');
    }
    if (token.used) {
      throw new EngineError(StudioErrorCode.STALE_REVISION, 'Reset confirmation token has already been used.');
    }
    if (Date.now() > token.expiresAt) {
      throw new EngineError(StudioErrorCode.STALE_REVISION, 'Reset confirmation token has expired.');
    }

    token.used = true;
    const chapterId = token.chapterId;

    const op = this.operations.acquireOperationLock({
      type: 'reset',
      chapterId,
      targetRevision: this.revision + 1,
    });

    try {
      this.operations.updatePhase(op.operationId, 'RESETTING', { chapterId });
      this.chapterStates.set(chapterId, LifecycleState.RESETTING);

      // 1. Stop container if currently running
      await this.stopChapterInternal(chapterId, 3);

      // 2. Remove container
      const containerName = `rag-studio-${chapterId}`;
      const snap = await this.engine.inspectContainer(containerName);
      if (snap) {
        this.operations.updatePhase(op.operationId, 'REMOVING_CONTAINER', { containerId: snap.id });
        try {
          await this.engine.removeContainer(snap.id);
        } catch (rmErr) {
          console.warn(`[RESET] Container remove notice:`, rmErr);
        }
      }

      // 3. Delete workspace & user volumes with safe retry
      this.operations.updatePhase(op.operationId, 'RESETTING_VOLUME', { volume: `rag-workspace-${chapterId}` });
      await this.safeRemoveVolume(`rag-workspace-${chapterId}`);
      await this.safeRemoveVolume(`rag-user-${chapterId}`);

      // 4. Re-create fresh empty volumes
      await this.engine.ensureVolume({
        name: `rag-workspace-${chapterId}`,
        installationId: this.installationId,
        role: 'chapter',
        chapterId,
      });

      await this.engine.ensureVolume({
        name: `rag-user-${chapterId}`,
        installationId: this.installationId,
        role: 'chapter',
        chapterId,
      });

      this.chapterStates.set(chapterId, LifecycleState.NOT_STARTED);
      this.chapterPortMap.delete(chapterId);
      this.revision++;

      this.operations.succeedOperation(op.operationId, {
        chapterId,
        resetComplete: true,
        state: LifecycleState.NOT_STARTED,
      });
    } catch (err: unknown) {
      this.chapterStates.set(chapterId, LifecycleState.ERROR);
      this.operations.failOperation(op.operationId, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  private async safeRemoveVolume(volumeName: string, maxAttempts = 3): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.engine.removeVolume(volumeName);
        return;
      } catch (err) {
        if (attempt === maxAttempts) {
          console.warn(`[RESET] Could not remove volume ${volumeName} after ${maxAttempts} attempts:`, err);
        } else {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }
  }

  private async createChapterContainer(chapter: Chapter, hostPort: number, generation: number): Promise<string> {
    const chapterId = chapter.id;
    const rawImage = chapter.runtime?.image;
    const targetImage = (rawImage && !rawImage.includes('ghcr.io') && !rawImage.includes('cloud-sdk')) ? rawImage : this.defaultImage;
    const spec: ContainerSpec = {
      name: `rag-studio-${chapterId}`,
      image: targetImage,
      installationId: this.installationId,
      chapterId,
      role: 'chapter',
      generation,
      labels: {
        [STUDIO_LABEL_KEYS.MANAGED]: 'true',
        [STUDIO_LABEL_KEYS.INSTALLATION]: this.installationId,
        [STUDIO_LABEL_KEYS.ROLE]: 'chapter',
        [STUDIO_LABEL_KEYS.CHAPTER]: chapterId,
        [STUDIO_LABEL_KEYS.GENERATION]: String(generation),
      },
      env: {
        CHAPTER: chapterId,
        STUDIO_COURSE_ID: chapterId,
        STUDIO_GENERATION: String(generation),
        RAG_ALLOWED_HOSTS: `127.0.0.1,localhost,127.0.0.1:${hostPort},localhost:${hostPort}`,
      },
      volumes: [
        {
          source: `rag-workspace-${chapterId}`,
          target: '/workspace',
          type: 'volume',
        },
        {
          source: `rag-user-${chapterId}`,
          target: '/home/coder',
          type: 'volume',
        },
      ],
      portBindings: [
        {
          hostIp: '127.0.0.1',
          hostPort,
          containerPort: 8080,
          protocol: 'tcp',
        },
      ],
      resources: {
        cpuMilli: Math.min(chapter.runtime?.resources?.cpuMilli || 2000, RESOURCE_CEILINGS.MAX_CPU_MILLI),
        memoryBytes: Math.min(
          (chapter.runtime?.resources?.memoryMiB || 3072) * 1024 * 1024,
          RESOURCE_CEILINGS.MAX_MEMORY_BYTES
        ),
        pidsLimit: RESOURCE_CEILINGS.MAX_PIDS,
      },
      stopGraceSeconds: RESOURCE_CEILINGS.DEFAULT_STOP_GRACE_SECONDS,
    };

    return await this.engine.createContainer(spec);
  }

  private async pollReadiness(
    port: number,
    timeoutMs: number,
    onProgress?: (elapsedSec: number) => void
  ): Promise<void> {
    const start = Date.now();
    const readyUrl = `http://127.0.0.1:${port}/health/ready`;
    let lastReportSec = 0;

    while (Date.now() - start < timeoutMs) {
      try {
        const statusCode = await new Promise<number>((resolve, reject) => {
          const req = http.get(readyUrl, { timeout: 1500 }, (res) => {
            resolve(res.statusCode || 500);
          });
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Readiness check timed out'));
          });
        });

        if (statusCode === 200) {
          return;
        }
      } catch (_) {
        // Retry
      }

      const elapsedSec = Math.round((Date.now() - start) / 1000);
      if (onProgress && elapsedSec !== lastReportSec && elapsedSec % 2 === 0) {
        lastReportSec = elapsedSec;
        onProgress(elapsedSec);
      }

      await new Promise((r) => setTimeout(r, 400));
    }

    throw new EngineError(
      StudioErrorCode.READINESS_TIMEOUT,
      `Readiness probe on ${readyUrl} failed after ${Math.round(timeoutMs / 1000)} seconds.`,
      { retryable: true }
    );
  }

  private async isPortHealthy(port: number, timeoutMs = 1500): Promise<boolean> {
    try {
      const readyUrl = `http://127.0.0.1:${port}/health/ready`;
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = http.get(readyUrl, { timeout: timeoutMs }, (res) => {
          resolve(res.statusCode || 500);
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Check timed out'));
        });
      });
      return statusCode === 200;
    } catch {
      return false;
    }
  }

  private async allocateFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (typeof addr === 'object' && addr !== null) {
          const port = addr.port;
          srv.close(() => resolve(port));
        } else {
          srv.close(() => reject(new Error('Failed to obtain free port')));
        }
      });
    });
  }
}
