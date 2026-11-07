/**
 * Studio Universal Orchestrator Error Types & Mapping
 * Reference: upgrade.md Sections 4.1, 4.2
 */

import { StudioErrorCode } from './types';

export class EngineError extends Error {
  public readonly code: StudioErrorCode;
  public readonly retryable: boolean;
  public readonly operationId?: string;
  public readonly details?: unknown;

  constructor(
    code: StudioErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      operationId?: string;
      details?: unknown;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.retryable = options?.retryable ?? isDefaultRetryable(code);
    this.operationId = options?.operationId;
    this.details = options?.details;
    if (options?.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      operationId: this.operationId,
      details: this.details,
    };
  }
}

function isDefaultRetryable(code: StudioErrorCode): boolean {
  switch (code) {
    case StudioErrorCode.ENGINE_UNAVAILABLE:
    case StudioErrorCode.READINESS_TIMEOUT:
    case StudioErrorCode.PORT_IN_USE:
      return true;
    case StudioErrorCode.PERMISSION_DENIED:
    case StudioErrorCode.NAME_CONFLICT:
    case StudioErrorCode.UNSUPPORTED_CAPABILITY:
    case StudioErrorCode.IMAGE_UNAVAILABLE:
    case StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE:
    case StudioErrorCode.DISK_FULL:
    case StudioErrorCode.SEED_FAILED:
    case StudioErrorCode.STOP_FAILED:
    case StudioErrorCode.STALE_REVISION:
    case StudioErrorCode.RESET_INCOMPLETE:
    default:
      return false;
  }
}

export function createEngineError(
  code: StudioErrorCode,
  message: string,
  options?: { retryable?: boolean; operationId?: string; details?: unknown; cause?: unknown }
): EngineError {
  return new EngineError(code, message, options);
}
