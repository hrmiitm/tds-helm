/**
 * Studio Universal Orchestrator - Gateway & Reverse Proxy Server
 * Reference: upgrade.md Sections 5, 6.1-6.4
 */
import { StateManager } from '../core/stateManager';
import { CatalogService } from '../catalog/catalogService';
import { OperationManager } from '../core/operations';
import { EngineAdapter } from '../engine/engineAdapter';
export interface GatewayServerOptions {
    port: number;
    bindAddress?: string;
    catalogUiDir: string;
    stateManager: StateManager;
    catalogService: CatalogService;
    operationManager: OperationManager;
    engine: EngineAdapter;
}
export declare class GatewayServer {
    private app;
    private server;
    private port;
    private bindAddress;
    private catalogUiDir;
    private stateManager;
    private catalogService;
    private operationManager;
    private engine;
    constructor(opts: GatewayServerOptions);
    private setupRoutes;
    private forwardHttpToContainer;
    start(): Promise<void>;
    stop(): Promise<void>;
}
