/**
 * Studio Universal Orchestrator - Operation Queue & Event Dispatcher
 * Reference: upgrade.md Sections 3, 4.3, 6.4
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import {
  OperationRecord,
  OperationType,
  EngineEvent,
  StudioErrorCode,
} from '../contracts/types';
import { EngineError } from '../contracts/errors';

export interface CreateOperationOptions {
  type: OperationType;
  chapterId: string;
  idempotencyKey?: string;
  targetRevision: number;
}

export class OperationManager extends EventEmitter {
  private operations: Map<string, OperationRecord> = new Map();
  private idempotencyMap: Map<string, string> = new Map(); // key -> operationId
  private activeOperationId: string | null = null;
  private eventHistory: EngineEvent[] = [];
  private eventSequence = 0;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  public getActiveOperation(): OperationRecord | null {
    if (!this.activeOperationId) return null;
    return this.operations.get(this.activeOperationId) || null;
  }

  public getOperation(id: string): OperationRecord | null {
    return this.operations.get(id) || null;
  }

  public getOperationByIdempotencyKey(key: string): OperationRecord | null {
    const opId = this.idempotencyMap.get(key);
    if (!opId) return null;
    return this.operations.get(opId) || null;
  }

  public acquireOperationLock(opts: CreateOperationOptions): OperationRecord {
    // Check idempotency first
    if (opts.idempotencyKey) {
      const existing = this.getOperationByIdempotencyKey(opts.idempotencyKey);
      if (existing) {
        if (existing.status === 'in_progress' || existing.status === 'pending') {
          return existing;
        }
      }
    }

    // Check concurrency lock: only ONE mutating operation allowed across all chapters
    if (this.activeOperationId) {
      const active = this.operations.get(this.activeOperationId);
      if (active && (active.status === 'in_progress' || active.status === 'pending')) {
        const ageMs = Date.now() - new Date(active.createdAt).getTime();
        if (ageMs > 60000) {
          console.warn(`[OP] Auto-expiring stale operation ${active.operationId} (${active.type}) after ${Math.round(ageMs / 1000)}s`);
          this.failOperation(active.operationId, new EngineError(StudioErrorCode.STALE_REVISION, 'Operation timed out after 60s'));
        } else {
          throw new EngineError(
            StudioErrorCode.STALE_REVISION,
            `Operation ${active.operationId} (${active.type} on ${active.chapterId}) is already in progress. Concurrent mutations are forbidden.`,
            { details: { activeOperation: active } }
          );
        }
      }
    }

    const now = new Date().toISOString();
    const opId = randomUUID();
    const op: OperationRecord = {
      operationId: opId,
      idempotencyKey: opts.idempotencyKey,
      type: opts.type,
      chapterId: opts.chapterId,
      phase: 'INITIALIZING',
      status: 'in_progress',
      targetRevision: opts.targetRevision,
      createdAt: now,
      updatedAt: now,
    };

    this.operations.set(opId, op);
    if (opts.idempotencyKey) {
      this.idempotencyMap.set(opts.idempotencyKey, opId);
    }
    this.activeOperationId = opId;

    this.emitEvent('operation_started', {
      operationId: opId,
      type: op.type,
      chapterId: op.chapterId,
      phase: op.phase,
    });

    return op;
  }

  public updatePhase(operationId: string, phase: string, details?: Record<string, unknown>): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    op.phase = phase;
    op.updatedAt = new Date().toISOString();

    this.emitEvent('phase_changed', {
      operationId,
      type: op.type,
      chapterId: op.chapterId,
      phase,
      details,
    });
  }

  public succeedOperation(operationId: string, result?: Record<string, unknown>): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    const now = new Date().toISOString();
    op.status = 'succeeded';
    op.phase = 'READY';
    op.updatedAt = now;
    op.completedAt = now;
    op.result = result;

    if (this.activeOperationId === operationId) {
      this.activeOperationId = null;
    }

    this.emitEvent('operation_succeeded', {
      operationId,
      type: op.type,
      chapterId: op.chapterId,
      result,
    });
  }

  public failOperation(operationId: string, error: EngineError | Error): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    const now = new Date().toISOString();
    op.status = 'failed';
    op.phase = 'ERROR';
    op.updatedAt = now;
    op.completedAt = now;

    if (error instanceof EngineError) {
      op.error = {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      };
    } else {
      op.error = {
        code: StudioErrorCode.STOP_FAILED,
        message: error.message || 'Operation failed with unexpected error',
        retryable: false,
      };
    }

    if (this.activeOperationId === operationId) {
      this.activeOperationId = null;
    }

    this.emitEvent('operation_failed', {
      operationId,
      type: op.type,
      chapterId: op.chapterId,
      error: op.error,
    });
  }

  public cancelOperation(operationId: string, reason = 'Cancelled by user'): void {
    const op = this.operations.get(operationId);
    if (!op) return;

    // Canceling is permitted only before non-reversible destructive commit
    if (op.phase === 'COMMITTED' || op.phase === 'RESETTING_VOLUME') {
      throw new EngineError(
        StudioErrorCode.STALE_REVISION,
        `Operation ${operationId} cannot be cancelled in phase '${op.phase}'. Destructive commit already executed.`
      );
    }

    const now = new Date().toISOString();
    op.status = 'cancelled';
    op.phase = 'CANCELLED';
    op.updatedAt = now;
    op.completedAt = now;
    op.error = {
      code: StudioErrorCode.STALE_REVISION,
      message: reason,
      retryable: true,
    };

    if (this.activeOperationId === operationId) {
      this.activeOperationId = null;
    }

    this.emitEvent('operation_cancelled', {
      operationId,
      type: op.type,
      chapterId: op.chapterId,
      reason,
    });
  }

  public emitEvent(action: string, payload: Record<string, unknown>): void {
    this.eventSequence++;
    const event: EngineEvent = {
      type: 'container',
      action,
      actor: {
        id: payload.operationId ? String(payload.operationId) : String(this.eventSequence),
        attributes: {
          sequence: String(this.eventSequence),
          ...Object.fromEntries(
            Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
          ),
        },
      },
      time: Math.floor(Date.now() / 1000),
    };

    this.eventHistory.push(event);
    if (this.eventHistory.length > 500) {
      this.eventHistory.shift();
    }

    this.emit('event', event);
  }

  public getRecentEvents(sinceSequence = 0): EngineEvent[] {
    if (sinceSequence <= 0) return [...this.eventHistory];
    return this.eventHistory.filter((ev) => {
      const seq = parseInt(ev.actor?.attributes?.sequence || '0', 10);
      return seq > sinceSequence;
    });
  }
}
