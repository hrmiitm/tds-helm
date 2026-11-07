"use strict";
/**
 * Engine Error Classification and Mapping
 * Reference: upgrade.md Section 4.2
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapEngineError = mapEngineError;
const contracts_1 = require("../contracts");
function mapEngineError(err, defaultMessage) {
    if (err instanceof contracts_1.EngineError) {
        return err;
    }
    const raw = err;
    const message = String(raw?.message || err || defaultMessage || 'Unknown engine error');
    const code = raw?.code || '';
    const statusCode = typeof raw?.statusCode === 'number' ? raw.statusCode : undefined;
    const stderr = typeof raw?.stderr === 'string' ? raw.stderr : '';
    const combined = `${message} ${stderr}`.toLowerCase();
    // 1. Connection / Engine unavailable
    if (code === 'ECONNREFUSED' ||
        code === 'ENOENT' ||
        combined.includes('cannot connect to the docker daemon') ||
        combined.includes('is the docker daemon running') ||
        combined.includes('cannot connect to the podman service') ||
        combined.includes('connection refused') ||
        combined.includes('daemon is not running') ||
        combined.includes('engine unavailable')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, `Engine daemon unreachable: ${message}`, { details: { code, stderr }, cause: err });
    }
    // 2. Permission denied
    if (code === 'EACCES' ||
        code === 'EPERM' ||
        statusCode === 401 ||
        statusCode === 403 ||
        combined.includes('permission denied') ||
        combined.includes('got permission denied while trying to connect') ||
        combined.includes('access is denied')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.PERMISSION_DENIED, `Engine permission denied: ${message}`, { details: { code, statusCode, stderr }, cause: err });
    }
    // 3. Name conflict
    if (statusCode === 409 ||
        combined.includes('already in use') ||
        combined.includes('conflict. the container name') ||
        combined.includes('conflict. the volume name') ||
        combined.includes('already exists')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.NAME_CONFLICT, `Engine resource name conflict: ${message}`, { details: { statusCode, stderr }, cause: err });
    }
    // 4. Port in use
    if (combined.includes('port is already allocated') ||
        combined.includes('address already in use') ||
        combined.includes('bind: address already in use') ||
        combined.includes('failed to bind port')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.PORT_IN_USE, `Requested network port is already in use: ${message}`, { details: { stderr }, cause: err });
    }
    // 5. Readiness timeout
    if (combined.includes('readiness timeout') || combined.includes('readiness deadline')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.READINESS_TIMEOUT, `Container readiness deadline exceeded: ${message}`, { details: { stderr }, cause: err });
    }
    // 6. Stop failed
    if (combined.includes('stop failed') || combined.includes('failed to stop')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.STOP_FAILED, `Failed to stop container: ${message}`, { details: { stderr }, cause: err });
    }
    // 7. Image unavailable
    if (combined.includes('image not found') ||
        combined.includes('pull access denied') ||
        combined.includes('repository does not exist') ||
        (statusCode === 404 && combined.includes('image'))) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.IMAGE_UNAVAILABLE, `Image not available: ${message}`, { details: { statusCode, stderr }, cause: err });
    }
    // 8. Resource limit unenforceable
    if (combined.includes('cgroup') ||
        combined.includes('resource limit') ||
        combined.includes('failed to set memory limit') ||
        combined.includes('failed to set cpu limit')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE, `Resource limit cannot be enforced: ${message}`, { details: { stderr }, cause: err });
    }
    // 9. Disk full
    if (combined.includes('no space left on device') || combined.includes('disk quota exceeded')) {
        return new contracts_1.EngineError(contracts_1.StudioErrorCode.DISK_FULL, `Disk full during engine operation: ${message}`, { details: { stderr }, cause: err });
    }
    // Default fallback
    return new contracts_1.EngineError(contracts_1.StudioErrorCode.ENGINE_UNAVAILABLE, message || 'Engine command execution failed', { details: { code, statusCode, stderr }, cause: err });
}
