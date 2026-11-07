"use strict";
/**
 * Studio Universal Resource Ceiling Enforcement
 * Reference: upgrade.md Section 4.3
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateResourceCeilings = validateResourceCeilings;
const types_1 = require("./types");
const errors_1 = require("./errors");
function validateResourceCeilings(req) {
    const cpuMilli = req?.cpuMilli ?? types_1.RESOURCE_CEILINGS.MAX_CPU_MILLI;
    const memoryMiB = req?.memoryMiB ?? types_1.RESOURCE_CEILINGS.MAX_MEMORY_MIB;
    if (cpuMilli > types_1.RESOURCE_CEILINGS.MAX_CPU_MILLI) {
        throw new errors_1.EngineError(types_1.StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE, `Requested CPU (${cpuMilli}m) exceeds maximum policy ceiling of ${types_1.RESOURCE_CEILINGS.MAX_CPU_MILLI}m (2 CPUs)`);
    }
    if (cpuMilli <= 0) {
        throw new errors_1.EngineError(types_1.StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE, `Requested CPU (${cpuMilli}m) must be greater than 0`);
    }
    if (memoryMiB > types_1.RESOURCE_CEILINGS.MAX_MEMORY_MIB) {
        throw new errors_1.EngineError(types_1.StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE, `Requested memory (${memoryMiB} MiB) exceeds maximum policy ceiling of ${types_1.RESOURCE_CEILINGS.MAX_MEMORY_MIB} MiB (3 GiB)`);
    }
    if (memoryMiB < 128) {
        throw new errors_1.EngineError(types_1.StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE, `Requested memory (${memoryMiB} MiB) must be at least 128 MiB`);
    }
    const memoryBytes = memoryMiB * 1024 * 1024;
    return {
        cpuMilli,
        memoryBytes,
        memorySwapBytes: memoryBytes, // Disable extra swap where supported
        pidsLimit: types_1.RESOURCE_CEILINGS.MAX_PIDS,
    };
}
