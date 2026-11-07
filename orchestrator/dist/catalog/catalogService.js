"use strict";
/**
 * Studio Universal Orchestrator - Catalog Service
 * Reference: upgrade.md Sections 5, 7.1-7.2
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("../contracts/types");
class CatalogService {
    coursesDir;
    stateManager;
    cachedChapters = new Map();
    constructor(coursesDir, stateManager) {
        this.coursesDir = coursesDir;
        this.stateManager = stateManager;
        this.reloadCatalog();
    }
    reloadCatalog() {
        this.cachedChapters.clear();
        if (!fs.existsSync(this.coursesDir)) {
            return [];
        }
        const entries = fs.readdirSync(this.coursesDir, { withFileTypes: true });
        for (const ent of entries) {
            if (!ent.isDirectory())
                continue;
            const chapterDir = path.join(this.coursesDir, ent.name);
            const yamlPath = path.join(chapterDir, 'course.yaml');
            const jsonPath = path.join(chapterDir, 'course.json');
            try {
                let chapter = null;
                if (fs.existsSync(jsonPath)) {
                    const raw = fs.readFileSync(jsonPath, 'utf8');
                    chapter = JSON.parse(raw);
                }
                else if (fs.existsSync(yamlPath)) {
                    // Parse simple fields or use YAML loader
                    chapter = this.parseSimpleYamlCourse(yamlPath, ent.name);
                }
                if (chapter && chapter.id) {
                    this.cachedChapters.set(chapter.id, chapter);
                }
            }
            catch (err) {
                console.warn(`[CATALOG] Failed to load course from ${ent.name}:`, err);
            }
        }
        return this.getChapters();
    }
    getChapters() {
        const chapters = [];
        const activeId = this.stateManager.getActiveChapterId();
        for (const [id, ch] of this.cachedChapters.entries()) {
            const state = this.stateManager.getChapterState(id);
            const isRunning = (id === activeId) && (state === types_1.LifecycleState.RUNNING);
            chapters.push({
                ...ch,
                state,
                observedState: state,
                activeGeneration: isRunning ? this.stateManager.getActiveGeneration() : undefined,
            });
        }
        const preferredOrder = ['rag-intro', 'mcp-agentic', 'agentic-ai', 'gcp-intro'];
        chapters.sort((a, b) => {
            const idxA = preferredOrder.indexOf(a.id);
            const idxB = preferredOrder.indexOf(b.id);
            if (idxA !== -1 && idxB !== -1)
                return idxA - idxB;
            if (idxA !== -1)
                return -1;
            if (idxB !== -1)
                return 1;
            return a.id.localeCompare(b.id);
        });
        return chapters;
    }
    getChapter(id) {
        const ch = this.cachedChapters.get(id);
        if (!ch)
            return null;
        const state = this.stateManager.getChapterState(id);
        const activeId = this.stateManager.getActiveChapterId();
        const isRunning = (id === activeId) && (state === types_1.LifecycleState.RUNNING);
        return {
            ...ch,
            state,
            observedState: state,
            activeGeneration: isRunning ? this.stateManager.getActiveGeneration() : undefined,
        };
    }
    parseSimpleYamlCourse(yamlPath, fallbackId) {
        const content = fs.readFileSync(yamlPath, 'utf8');
        const lines = content.split('\n');
        let id = fallbackId;
        let title = fallbackId;
        let description = '';
        let badge = '';
        let difficulty = 'intermediate';
        let estimatedMinutes = 180;
        let image = 'rag-studio:4.2.0';
        let cpuMilli = 2000;
        let memoryMiB = 3072;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('modules:'))
                break;
            if (trimmed.startsWith('id:') && id === fallbackId)
                id = trimmed.replace('id:', '').trim().replace(/['"]/g, '');
            if (trimmed.startsWith('title:') && title === fallbackId)
                title = trimmed.replace('title:', '').trim().replace(/['"]/g, '');
            if (trimmed.startsWith('description:') && !description)
                description = trimmed.replace('description:', '').trim().replace(/['"]/g, '');
            if (trimmed.startsWith('badge:') && !badge)
                badge = trimmed.replace('badge:', '').trim().replace(/['"]/g, '');
            if (trimmed.startsWith('difficulty:'))
                difficulty = trimmed.replace('difficulty:', '').trim().replace(/['"]/g, '');
            if (trimmed.startsWith('estimatedMinutes:')) {
                const val = parseInt(trimmed.replace('estimatedMinutes:', '').trim(), 10);
                if (!isNaN(val))
                    estimatedMinutes = val;
            }
            if (trimmed.startsWith('image:')) {
                const val = trimmed.replace('image:', '').trim().replace(/['"]/g, '');
                image = (val.includes('ghcr.io') || val.includes('cloud-sdk')) ? 'rag-studio:4.2.0' : val;
            }
            if (trimmed.startsWith('cpuMilli:')) {
                const val = parseInt(trimmed.replace('cpuMilli:', '').trim(), 10);
                if (!isNaN(val))
                    cpuMilli = val;
            }
            if (trimmed.startsWith('memoryMiB:')) {
                const val = parseInt(trimmed.replace('memoryMiB:', '').trim(), 10);
                if (!isNaN(val))
                    memoryMiB = val;
            }
        }
        return {
            id,
            version: '1.1.0',
            title,
            description,
            badge: badge || (id.includes('mcp') ? 'MCP & Agents' : 'Vector RAG'),
            metadata: {
                id,
                version: '1.1.0',
                title,
                badge,
                description,
                difficulty,
                estimatedMinutes,
            },
            runtime: {
                profile: id,
                image,
                tools: ['vscode', 'jupyter', 'preview'],
                resources: {
                    cpuMilli,
                    memoryMiB,
                },
            },
            content: {
                tasks: 'tasks.json',
                slides: 'slides/index.html',
                workspace: 'workspace',
            },
            modules: [],
        };
    }
}
exports.CatalogService = CatalogService;
