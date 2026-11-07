/**
 * Studio Universal Orchestrator - Catalog Service
 * Reference: upgrade.md Sections 5, 7.1-7.2
 */
import { Chapter } from '../contracts/types';
import { StateManager } from '../core/stateManager';
export declare class CatalogService {
    private coursesDir;
    private stateManager;
    private cachedChapters;
    constructor(coursesDir: string, stateManager: StateManager);
    reloadCatalog(): Chapter[];
    getChapters(): Chapter[];
    getChapter(id: string): Chapter | null;
    private parseSimpleYamlCourse;
}
