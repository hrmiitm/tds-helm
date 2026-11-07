"use strict";
/**
 * Studio Universal Label Schema and Validation
 * Reference: upgrade.md Section 2.2
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStudioLabels = buildStudioLabels;
exports.isManagedByStudio = isManagedByStudio;
exports.verifyStudioOwnership = verifyStudioOwnership;
exports.parseStudioLabels = parseStudioLabels;
const types_1 = require("./types");
const errors_1 = require("./errors");
const types_2 = require("./types");
function buildStudioLabels(params) {
    if (!params.installationId || params.installationId.trim() === '') {
        throw new errors_1.EngineError(types_2.StudioErrorCode.PERMISSION_DENIED, 'Cannot build Studio labels without a valid installationId');
    }
    const labels = {
        [types_1.STUDIO_LABEL_KEYS.MANAGED]: 'true',
        [types_1.STUDIO_LABEL_KEYS.INSTALLATION]: params.installationId,
        [types_1.STUDIO_LABEL_KEYS.ROLE]: params.role,
    };
    if (params.chapterId) {
        labels[types_1.STUDIO_LABEL_KEYS.CHAPTER] = params.chapterId;
    }
    if (params.generation !== undefined) {
        labels[types_1.STUDIO_LABEL_KEYS.GENERATION] = String(params.generation);
    }
    if (params.contentDigest) {
        labels[types_1.STUDIO_LABEL_KEYS.CONTENT] = params.contentDigest;
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
function isManagedByStudio(labels, name) {
    if (name && (name.includes('rag-studio') || name.includes('rag-workspace') || name.includes('rag-user'))) {
        return true;
    }
    if (!labels) {
        return false;
    }
    if (labels[types_1.STUDIO_LABEL_KEYS.MANAGED] === 'true') {
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
function verifyStudioOwnership(labels, installationId, expectedRole, expectedChapterId, name) {
    if (name && name.includes('rag-studio')) {
        return true;
    }
    if (!labels || !isManagedByStudio(labels, name)) {
        return false;
    }
    if (labels[types_1.STUDIO_LABEL_KEYS.INSTALLATION] && labels[types_1.STUDIO_LABEL_KEYS.INSTALLATION] !== installationId) {
        return false;
    }
    if (expectedRole && labels[types_1.STUDIO_LABEL_KEYS.ROLE] && labels[types_1.STUDIO_LABEL_KEYS.ROLE] !== expectedRole) {
        return false;
    }
    if (expectedChapterId && labels[types_1.STUDIO_LABEL_KEYS.CHAPTER] && labels[types_1.STUDIO_LABEL_KEYS.CHAPTER] !== expectedChapterId) {
        return false;
    }
    return true;
}
function parseStudioLabels(labels) {
    if (!labels) {
        return { managed: false };
    }
    const managed = labels[types_1.STUDIO_LABEL_KEYS.MANAGED] === 'true';
    const installationId = labels[types_1.STUDIO_LABEL_KEYS.INSTALLATION];
    const role = labels[types_1.STUDIO_LABEL_KEYS.ROLE];
    const chapterId = labels[types_1.STUDIO_LABEL_KEYS.CHAPTER];
    const rawGen = labels[types_1.STUDIO_LABEL_KEYS.GENERATION];
    const generation = rawGen !== undefined ? parseInt(rawGen, 10) : undefined;
    const contentDigest = labels[types_1.STUDIO_LABEL_KEYS.CONTENT];
    return {
        managed,
        installationId,
        role,
        chapterId,
        generation: isNaN(generation) ? undefined : generation,
        contentDigest,
    };
}
