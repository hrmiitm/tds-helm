/**
 * Studio Universal Label Schema and Validation
 * Reference: upgrade.md Section 2.2
 */
import { StudioRole } from './types';
export declare function buildStudioLabels(params: {
    installationId: string;
    role: StudioRole;
    chapterId?: string;
    generation?: number;
    contentDigest?: string;
    extra?: Record<string, string>;
}): Record<string, string>;
export declare function isManagedByStudio(labels?: Record<string, string> | null, name?: string): boolean;
export declare function verifyStudioOwnership(labels: Record<string, string> | undefined | null, installationId: string, expectedRole?: StudioRole, expectedChapterId?: string, name?: string): boolean;
export declare function parseStudioLabels(labels?: Record<string, string> | null): {
    managed: boolean;
    installationId?: string;
    role?: StudioRole;
    chapterId?: string;
    generation?: number;
    contentDigest?: string;
};
