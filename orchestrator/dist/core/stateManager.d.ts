/**
 * Studio Universal Orchestrator - Lifecycle State Machine & Chapter Orchestrator
 * Reference: upgrade.md Sections 2.1, 2.2, 3.1-3.3, 4.2-4.4
 */
import { LifecycleState, Chapter, RuntimeSnapshot, ResetToken } from '../contracts/types';
import { EngineAdapter } from '../engine/engineAdapter';
import { OperationManager } from './operations';
export interface StateManagerOptions {
    installationId: string;
    engine: EngineAdapter;
    operations: OperationManager;
    defaultImage?: string;
    networkName?: string;
}
export declare class StateManager {
    private installationId;
    private engine;
    private operations;
    private defaultImage;
    private networkName;
    private chapterStates;
    private chapterGenerations;
    private chapterPortMap;
    private activeChapterId;
    private activeGeneration;
    private activeSnapshot;
    private resetTokens;
    private revision;
    constructor(opts: StateManagerOptions);
    getRevision(): number;
    getActiveChapterId(): string | null;
    getActiveGeneration(): number;
    getActiveSnapshot(): RuntimeSnapshot | null;
    getChapterState(chapterId: string): LifecycleState;
    getActivePort(): number | null;
    /**
     * Reconciles observed engine state with in-memory state.
     */
    reconcile(): Promise<void>;
    /**
     * Launches or resumes a chapter runtime container.
     * Strictly enforces the single-active chapter policy.
     */
    launchChapter(chapter: Chapter, idempotencyKey?: string): Promise<{
        operationId: string;
        chapterId: string;
        generation: number;
        port: number;
        sessionUrl: string;
    }>;
    /**
     * Stops an active chapter container.
     */
    stopChapter(chapterId: string, graceSeconds?: number): Promise<void>;
    private stopChapterInternal;
    /**
     * Issues a signed ResetToken requiring explicit confirmation before data destruction.
     */
    prepareResetConfirmation(chapterId: string): ResetToken;
    /**
     * Executes a confirmed factory reset on a chapter.
     */
    executeReset(tokenStr: string): Promise<void>;
    private safeRemoveVolume;
    private createChapterContainer;
    private pollReadiness;
    private isPortHealthy;
    private allocateFreePort;
}
