"use strict";
/**
 * Studio Universal Orchestrator Contracts & DTOs
 * Reference: upgrade.md Sections 2.1, 2.2, 3, 4.1-4.4
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudioErrorCode = exports.RESOURCE_CEILINGS = exports.STUDIO_LABEL_KEYS = exports.LifecycleState = void 0;
var LifecycleState;
(function (LifecycleState) {
    LifecycleState["NOT_STARTED"] = "NOT_STARTED";
    LifecycleState["PREPARING"] = "PREPARING";
    LifecycleState["STARTING"] = "STARTING";
    LifecycleState["RUNNING"] = "RUNNING";
    LifecycleState["STOPPING"] = "STOPPING";
    LifecycleState["STOPPED"] = "STOPPED";
    LifecycleState["RESETTING"] = "RESETTING";
    LifecycleState["ERROR"] = "ERROR";
    LifecycleState["UNKNOWN"] = "UNKNOWN";
})(LifecycleState || (exports.LifecycleState = LifecycleState = {}));
exports.STUDIO_LABEL_KEYS = {
    MANAGED: 'io.studio.managed',
    INSTALLATION: 'io.studio.installation',
    ROLE: 'io.studio.role',
    CHAPTER: 'io.studio.chapter',
    GENERATION: 'io.studio.generation',
    CONTENT: 'io.studio.content',
};
exports.RESOURCE_CEILINGS = {
    MAX_CPUS: 2,
    MAX_CPU_MILLI: 2000,
    MAX_MEMORY_MIB: 3072,
    MAX_MEMORY_BYTES: 3072 * 1024 * 1024,
    MAX_PIDS: 256,
    DEFAULT_STOP_GRACE_SECONDS: 15,
};
var StudioErrorCode;
(function (StudioErrorCode) {
    StudioErrorCode["ENGINE_UNAVAILABLE"] = "ENGINE_UNAVAILABLE";
    StudioErrorCode["PERMISSION_DENIED"] = "PERMISSION_DENIED";
    StudioErrorCode["UNSUPPORTED_CAPABILITY"] = "UNSUPPORTED_CAPABILITY";
    StudioErrorCode["NAME_CONFLICT"] = "NAME_CONFLICT";
    StudioErrorCode["PORT_IN_USE"] = "PORT_IN_USE";
    StudioErrorCode["IMAGE_UNAVAILABLE"] = "IMAGE_UNAVAILABLE";
    StudioErrorCode["RESOURCE_LIMIT_UNENFORCEABLE"] = "RESOURCE_LIMIT_UNENFORCEABLE";
    StudioErrorCode["DISK_FULL"] = "DISK_FULL";
    StudioErrorCode["SEED_FAILED"] = "SEED_FAILED";
    StudioErrorCode["READINESS_TIMEOUT"] = "READINESS_TIMEOUT";
    StudioErrorCode["STOP_FAILED"] = "STOP_FAILED";
    StudioErrorCode["STALE_REVISION"] = "STALE_REVISION";
    StudioErrorCode["RESET_INCOMPLETE"] = "RESET_INCOMPLETE";
})(StudioErrorCode || (exports.StudioErrorCode = StudioErrorCode = {}));
