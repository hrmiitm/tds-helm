/**
 * Studio Universal Orchestrator - Main Daemon Entrypoint
 * Reference: upgrade.md Sections 2, 5, 6
 */
import { GatewayServer } from './gateway/gatewayServer';
export declare function startOrchestratorServer(options?: {
    port?: number;
    bindAddress?: string;
    installationId?: string;
    coursesDir?: string;
    catalogUiDir?: string;
}): Promise<GatewayServer>;
