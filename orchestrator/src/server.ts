/**
 * Studio Universal Orchestrator - Main Daemon Entrypoint
 * Reference: upgrade.md Sections 2, 5, 6
 */

import * as path from 'path';
import { StateManager } from './core/stateManager';
import { OperationManager } from './core/operations';
import { CatalogService } from './catalog/catalogService';
import { GatewayServer } from './gateway/gatewayServer';
import { discoverEngine } from './engine/engineDiscovery';
import { DockerCliAdapter } from './engine/dockerCliAdapter';
import { DockerHttpAdapter } from './engine/dockerHttpAdapter';

export async function startOrchestratorServer(options?: {
  port?: number;
  bindAddress?: string;
  installationId?: string;
  coursesDir?: string;
  catalogUiDir?: string;
}): Promise<GatewayServer> {
  const port = options?.port || parseInt(process.env.PORT || '8080', 10);
  const bindAddress = options?.bindAddress || process.env.BIND_ADDRESS || '127.0.0.1';
  const installationId = options?.installationId || process.env.STUDIO_INSTALLATION_ID || 'default-studio';

  // Discover paths
  const rootDir = path.resolve(__dirname, '../../');
  const coursesDir = options?.coursesDir || process.env.COURSES_DIR || path.join(rootDir, 'courses');
  const catalogUiDir = options?.catalogUiDir || process.env.CATALOG_UI_DIR || path.join(rootDir, 'catalog-ui');

  // Discover and initialize engine adapter
  const discovery = await discoverEngine();
  console.log(`[ORCHESTRATOR] Discovered engine: ${discovery.engineType} (${discovery.endpoint})`);

  let engine;
  if (discovery.transport === 'socket' || discovery.transport === 'named_pipe') {
    engine = new DockerHttpAdapter({
      socketPath: discovery.endpoint,
      engineType: discovery.engineType,
    });
  } else {
    engine = new DockerCliAdapter({
      cliPath: discovery.cliPath,
      engineType: discovery.engineType,
    });
  }

  const opManager = new OperationManager();
  const stateManager = new StateManager({
    installationId,
    engine,
    operations: opManager,
    defaultImage: process.env.STUDIO_RUNTIME_IMAGE || 'rag-studio:4.2.0',
  });

  const catalogService = new CatalogService(coursesDir, stateManager);

  const gateway = new GatewayServer({
    port,
    bindAddress,
    catalogUiDir,
    stateManager,
    catalogService,
    operationManager: opManager,
    engine,
  });

  await gateway.start();
  return gateway;
}

if (require.main === module) {
  startOrchestratorServer().catch((err) => {
    console.error('[ORCHESTRATOR] Fatal startup error:', err);
    process.exit(1);
  });
}
