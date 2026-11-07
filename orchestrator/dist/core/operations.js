"use strict";
/**
 * Studio Universal Orchestrator - Operation Queue & Event Dispatcher
 * Reference: upgrade.md Sections 3, 4.3, 6.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationManager = void 0;
const events_1 = require("events");
const crypto_1 = require("crypto");
const types_1 = require("../contracts/types");
const errors_1 = require("../contracts/errors");
class OperationManager extends events_1.EventEmitter {
    operations = new Map();
    idempotencyMap = new Map(); // key -> operationId
    activeOperationId = null;
    eventHistory = [];
    eventSequence = 0;
    constructor() {
        super();
        this.setMaxListeners(100);
    }
    getActiveOperation() {
        if (!this.activeOperationId)
            return null;
        return this.operations.get(this.activeOperationId) || null;
    }
    getOperation(id) {
        return this.operations.get(id) || null;
    }
    getOperationByIdempotencyKey(key) {
        const opId = this.idempotencyMap.get(key);
        if (!opId)
            return null;
        return this.operations.get(opId) || null;
    }
    acquireOperationLock(opts) {
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
                    this.failOperation(active.operationId, new errors_1.EngineError(types_1.StudioErrorCode.STALE_REVISION, 'Operation timed out after 60s'));
                }
                else {
                    throw new errors_1.EngineError(types_1.StudioErrorCode.STALE_REVISION, `Operation ${active.operationId} (${active.type} on ${active.chapterId}) is already in progress. Concurrent mutations are forbidden.`, { details: { activeOperation: active } });
                }
            }
        }
        const now = new Date().toISOString();
        const opId = (0, crypto_1.randomUUID)();
        const op = {
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
    updatePhase(operationId, phase, details) {
        const op = this.operations.get(operationId);
        if (!op)
            return;
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
    succeedOperation(operationId, result) {
        const op = this.operations.get(operationId);
        if (!op)
            return;
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
    failOperation(operationId, error) {
        const op = this.operations.get(operationId);
        if (!op)
            return;
        const now = new Date().toISOString();
        op.status = 'failed';
        op.phase = 'ERROR';
        op.updatedAt = now;
        op.completedAt = now;
        if (error instanceof errors_1.EngineError) {
            op.error = {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
                details: error.details,
            };
        }
        else {
            op.error = {
                code: types_1.StudioErrorCode.STOP_FAILED,
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
    cancelOperation(operationId, reason = 'Cancelled by user') {
        const op = this.operations.get(operationId);
        if (!op)
            return;
        // Canceling is permitted only before non-reversible destructive commit
        if (op.phase === 'COMMITTED' || op.phase === 'RESETTING_VOLUME') {
            throw new errors_1.EngineError(types_1.StudioErrorCode.STALE_REVISION, `Operation ${operationId} cannot be cancelled in phase '${op.phase}'. Destructive commit already executed.`);
        }
        const now = new Date().toISOString();
        op.status = 'cancelled';
        op.phase = 'CANCELLED';
        op.updatedAt = now;
        op.completedAt = now;
        op.error = {
            code: types_1.StudioErrorCode.STALE_REVISION,
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
    emitEvent(action, payload) {
        this.eventSequence++;
        const event = {
            type: 'container',
            action,
            actor: {
                id: payload.operationId ? String(payload.operationId) : String(this.eventSequence),
                attributes: {
                    sequence: String(this.eventSequence),
                    ...Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])),
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
    getRecentEvents(sinceSequence = 0) {
        if (sinceSequence <= 0)
            return [...this.eventHistory];
        return this.eventHistory.filter((ev) => {
            const seq = parseInt(ev.actor?.attributes?.sequence || '0', 10);
            return seq > sinceSequence;
        });
    }
}
exports.OperationManager = OperationManager;
