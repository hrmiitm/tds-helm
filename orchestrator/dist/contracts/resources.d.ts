/**
 * Studio Universal Resource Ceiling Enforcement
 * Reference: upgrade.md Section 4.3
 */
import { ContainerResourceLimits, ResourceRequirements } from './types';
export declare function validateResourceCeilings(req?: Partial<ResourceRequirements>): ContainerResourceLimits;
