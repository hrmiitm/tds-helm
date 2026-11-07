"use strict";
/**
 * Studio Universal Orchestrator - Main Daemon Entrypoint
 * Reference: upgrade.md Sections 2, 5, 6
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
exports.startOrchestratorServer = startOrchestratorServer;
const path = __importStar(require("path"));
const stateManager_1 = require("./core/stateManager");
const operations_1 = require("./core/operations");
const catalogService_1 = require("./catalog/catalogService");
const gatewayServer_1 = require("./gateway/gatewayServer");
const engineDiscovery_1 = require("./engine/engineDiscovery");
const dockerCliAdapter_1 = require("./engine/dockerCliAdapter");
const dockerHttpAdapter_1 = require("./engine/dockerHttpAdapter");
async function startOrchestratorServer(options) {
    const port = options?.port || parseInt(process.env.PORT || '8080', 10);
    const bindAddress = options?.bindAddress || process.env.BIND_ADDRESS || '127.0.0.1';
    const installationId = options?.installationId || process.env.STUDIO_INSTALLATION_ID || 'default-studio';
    // Discover paths
    const rootDir = path.resolve(__dirname, '../../');
    const coursesDir = options?.coursesDir || process.env.COURSES_DIR || path.join(rootDir, 'courses');
    const catalogUiDir = options?.catalogUiDir || process.env.CATALOG_UI_DIR || path.join(rootDir, 'catalog-ui');
    // Discover and initialize engine adapter
    const discovery = await (0, engineDiscovery_1.discoverEngine)();
    console.log(`[ORCHESTRATOR] Discovered engine: ${discovery.engineType} (${discovery.endpoint})`);
    let engine;
    if (discovery.transport === 'socket' || discovery.transport === 'named_pipe') {
        engine = new dockerHttpAdapter_1.DockerHttpAdapter({
            socketPath: discovery.endpoint,
            engineType: discovery.engineType,
        });
    }
    else {
        engine = new dockerCliAdapter_1.DockerCliAdapter({
            cliPath: discovery.cliPath,
            engineType: discovery.engineType,
        });
    }
    const opManager = new operations_1.OperationManager();
    const stateManager = new stateManager_1.StateManager({
        installationId,
        engine,
        operations: opManager,
        defaultImage: process.env.STUDIO_RUNTIME_IMAGE || 'rag-studio:4.2.0',
    });
    const catalogService = new catalogService_1.CatalogService(coursesDir, stateManager);
    const gateway = new gatewayServer_1.GatewayServer({
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
