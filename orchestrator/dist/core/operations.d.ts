/**
 * Studio Universal Orchestrator - Operation Queue & Event Dispatcher
 * Reference: upgrade.md Sections 3, 4.3, 6.4
 */
import { EventEmitter } from 'events';
import { OperationRecord, OperationType, EngineEvent } from '../contracts/types';
import { EngineError } from '../contracts/errors';
export interface CreateOperationOptions {
    type: OperationType;
    chapterId: string;
    idempotencyKey?: string;
    targetRevision: number;
}
export declare class OperationManager extends EventEmitter {
    private operations;
    private idempotencyMap;
    private activeOperationId;
    private eventHistory;
    private eventSequence;
    constructor();
    getActiveOperation(): OperationRecord | null;
    getOperation(id: string): OperationRecord | null;
    getOperationByIdempotencyKey(key: string): OperationRecord | null;
    acquireOperationLock(opts: CreateOperationOptions): OperationRecord;
    updatePhase(operationId: string, phase: string, details?: Record<string, unknown>): void;
    succeedOperation(operationId: string, result?: Record<string, unknown>): void;
    failOperation(operationId: string, error: EngineError | Error): void;
    cancelOperation(operationId: string, reason?: string): void;
    emitEvent(action: string, payload: Record<string, unknown>): void;
    getRecentEvents(sinceSequence?: number): EngineEvent[];
}
