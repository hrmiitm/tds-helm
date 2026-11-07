/**
 * Studio Universal Orchestrator Error Types & Mapping
 * Reference: upgrade.md Sections 4.1, 4.2
 */
import { StudioErrorCode } from './types';
export declare class EngineError extends Error {
    readonly code: StudioErrorCode;
    readonly retryable: boolean;
    readonly operationId?: string;
    readonly details?: unknown;
    constructor(code: StudioErrorCode, message: string, options?: {
        retryable?: boolean;
        operationId?: string;
        details?: unknown;
        cause?: unknown;
    });
    toJSON(): Record<string, unknown>;
}
export declare function createEngineError(code: StudioErrorCode, message: string, options?: {
    retryable?: boolean;
    operationId?: string;
    details?: unknown;
    cause?: unknown;
}): EngineError;
