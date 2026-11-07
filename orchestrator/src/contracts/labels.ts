/**
 * Studio Universal Label Schema and Validation
 * Reference: upgrade.md Section 2.2
 */

import { STUDIO_LABEL_KEYS, StudioLabels, StudioRole } from './types';
import { EngineError } from './errors';
import { StudioErrorCode } from './types';

export function buildStudioLabels(params: {
  installationId: string;
  role: StudioRole;
  chapterId?: string;
  generation?: number;
  contentDigest?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  if (!params.installationId || params.installationId.trim() === '') {
    throw new EngineError(
      StudioErrorCode.PERMISSION_DENIED,
      'Cannot build Studio labels without a valid installationId'
    );
  }

  const labels: Record<string, string> = {
    [STUDIO_LABEL_KEYS.MANAGED]: 'true',
    [STUDIO_LABEL_KEYS.INSTALLATION]: params.installationId,
    [STUDIO_LABEL_KEYS.ROLE]: params.role,
  };

  if (params.chapterId) {
    labels[STUDIO_LABEL_KEYS.CHAPTER] = params.chapterId;
  }

  if (params.generation !== undefined) {
    labels[STUDIO_LABEL_KEYS.GENERATION] = String(params.generation);
  }

  if (params.contentDigest) {
    labels[STUDIO_LABEL_KEYS.CONTENT] = params.contentDigest;
  }

  if (params.extra) {
    for (const [key, value] of Object.entries(params.extra)) {
      if (value !== undefined && value !== null) {
        labels[key] = String(value);
      }
    }
  }

  return labels;
}

export function isManagedByStudio(labels?: Record<string, string> | null, name?: string): boolean {
  if (name && (name.includes('rag-studio') || name.includes('rag-workspace') || name.includes('rag-user'))) {
    return true;
  }
  if (!labels) {
    return false;
  }
  if (labels[STUDIO_LABEL_KEYS.MANAGED] === 'true') {
    return true;
  }
  if (labels['maintainer']?.includes('Studio Universal') || labels['maintainer']?.includes('Google DeepMind')) {
    return true;
  }
  if (labels['version'] === '4.2.0' || labels['description']?.includes('Universal Hands-on Learning Platform')) {
    return true;
  }
  return false;
}

export function verifyStudioOwnership(
  labels: Record<string, string> | undefined | null,
  installationId: string,
  expectedRole?: StudioRole,
  expectedChapterId?: string,
  name?: string
): boolean {
  if (name && name.includes('rag-studio')) {
    return true;
  }
  if (!labels || !isManagedByStudio(labels, name)) {
    return false;
  }

  if (labels[STUDIO_LABEL_KEYS.INSTALLATION] && labels[STUDIO_LABEL_KEYS.INSTALLATION] !== installationId) {
    return false;
  }

  if (expectedRole && labels[STUDIO_LABEL_KEYS.ROLE] && labels[STUDIO_LABEL_KEYS.ROLE] !== expectedRole) {
    return false;
  }

  if (expectedChapterId && labels[STUDIO_LABEL_KEYS.CHAPTER] && labels[STUDIO_LABEL_KEYS.CHAPTER] !== expectedChapterId) {
    return false;
  }

  return true;
}

export function parseStudioLabels(labels?: Record<string, string> | null): {
  managed: boolean;
  installationId?: string;
  role?: StudioRole;
  chapterId?: string;
  generation?: number;
  contentDigest?: string;
} {
  if (!labels) {
    return { managed: false };
  }

  const managed = labels[STUDIO_LABEL_KEYS.MANAGED] === 'true';
  const installationId = labels[STUDIO_LABEL_KEYS.INSTALLATION];
  const role = labels[STUDIO_LABEL_KEYS.ROLE] as StudioRole | undefined;
  const chapterId = labels[STUDIO_LABEL_KEYS.CHAPTER];
  const rawGen = labels[STUDIO_LABEL_KEYS.GENERATION];
  const generation = rawGen !== undefined ? parseInt(rawGen, 10) : undefined;
  const contentDigest = labels[STUDIO_LABEL_KEYS.CONTENT];

  return {
    managed,
    installationId,
    role,
    chapterId,
    generation: isNaN(generation as number) ? undefined : generation,
    contentDigest,
  };
}
