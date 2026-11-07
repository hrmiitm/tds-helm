/**
 * Studio Universal Resource Ceiling Enforcement
 * Reference: upgrade.md Section 4.3
 */

import { ContainerResourceLimits, ResourceRequirements, RESOURCE_CEILINGS, StudioErrorCode } from './types';
import { EngineError } from './errors';

export function validateResourceCeilings(
  req?: Partial<ResourceRequirements>
): ContainerResourceLimits {
  const cpuMilli = req?.cpuMilli ?? RESOURCE_CEILINGS.MAX_CPU_MILLI;
  const memoryMiB = req?.memoryMiB ?? RESOURCE_CEILINGS.MAX_MEMORY_MIB;

  if (cpuMilli > RESOURCE_CEILINGS.MAX_CPU_MILLI) {
    throw new EngineError(
      StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE,
      `Requested CPU (${cpuMilli}m) exceeds maximum policy ceiling of ${RESOURCE_CEILINGS.MAX_CPU_MILLI}m (2 CPUs)`
    );
  }

  if (cpuMilli <= 0) {
    throw new EngineError(
      StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE,
      `Requested CPU (${cpuMilli}m) must be greater than 0`
    );
  }

  if (memoryMiB > RESOURCE_CEILINGS.MAX_MEMORY_MIB) {
    throw new EngineError(
      StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE,
      `Requested memory (${memoryMiB} MiB) exceeds maximum policy ceiling of ${RESOURCE_CEILINGS.MAX_MEMORY_MIB} MiB (3 GiB)`
    );
  }

  if (memoryMiB < 128) {
    throw new EngineError(
      StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE,
      `Requested memory (${memoryMiB} MiB) must be at least 128 MiB`
    );
  }

  const memoryBytes = memoryMiB * 1024 * 1024;

  return {
    cpuMilli,
    memoryBytes,
    memorySwapBytes: memoryBytes, // Disable extra swap where supported
    pidsLimit: RESOURCE_CEILINGS.MAX_PIDS,
  };
}
