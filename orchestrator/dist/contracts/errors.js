"use strict";
/**
 * Studio Universal Orchestrator Error Types & Mapping
 * Reference: upgrade.md Sections 4.1, 4.2
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineError = void 0;
exports.createEngineError = createEngineError;
const types_1 = require("./types");
class EngineError extends Error {
    code;
    retryable;
    operationId;
    details;
    constructor(code, message, options) {
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
    toJSON() {
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
exports.EngineError = EngineError;
function isDefaultRetryable(code) {
    switch (code) {
        case types_1.StudioErrorCode.ENGINE_UNAVAILABLE:
        case types_1.StudioErrorCode.READINESS_TIMEOUT:
        case types_1.StudioErrorCode.PORT_IN_USE:
            return true;
        case types_1.StudioErrorCode.PERMISSION_DENIED:
        case types_1.StudioErrorCode.NAME_CONFLICT:
        case types_1.StudioErrorCode.UNSUPPORTED_CAPABILITY:
        case types_1.StudioErrorCode.IMAGE_UNAVAILABLE:
        case types_1.StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE:
        case types_1.StudioErrorCode.DISK_FULL:
        case types_1.StudioErrorCode.SEED_FAILED:
        case types_1.StudioErrorCode.STOP_FAILED:
        case types_1.StudioErrorCode.STALE_REVISION:
        case types_1.StudioErrorCode.RESET_INCOMPLETE:
        default:
            return false;
    }
}
function createEngineError(code, message, options) {
    return new EngineError(code, message, options);
}
