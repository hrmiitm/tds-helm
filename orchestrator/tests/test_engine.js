/**
 * Standalone Engine Adapter Verification Script
 * Reference: upgrade.md Sections 4.1, 4.2, 4.3, 4.4, 9 (P0-A, P0-C)
 * Strictly zero emojis in output.
 */

const assert = require('node:assert');
const {
  discoverEngine,
  DockerCliAdapter,
  DockerHttpAdapter,
  RESOURCE_CEILINGS,
  validateResourceCeilings,
  STUDIO_LABEL_KEYS,
  StudioErrorCode,
  EngineError,
} = require('../dist');

const TEST_INSTALLATION_ID = 'test-inst-uuid-11223344';
const TEST_CHAPTER_ID = 'rag-intro';
const TEST_CONTAINER_NAME = `rag-studio-test-${Date.now()}`;
const TEST_VOLUME_NAME = `rag-workspace-test-${Date.now()}`;

async function runVerification() {
  console.log('[TEST] Starting Studio Universal Engine Adapter Verification');

  // 1. Resource Ceilings
  console.log('[TEST] 1. Verifying Resource Ceilings Enforcement');
  const validLimits = validateResourceCeilings({ cpuMilli: 1500, memoryMiB: 2048 });
  assert.strictEqual(validLimits.cpuMilli, 1500);
  assert.strictEqual(validLimits.memoryBytes, 2048 * 1024 * 1024);
  assert.strictEqual(validLimits.pidsLimit, RESOURCE_CEILINGS.MAX_PIDS);

  let cpuRejected = false;
  try {
    validateResourceCeilings({ cpuMilli: 3000, memoryMiB: 1024 });
  } catch (err) {
    if (err instanceof EngineError && err.code === StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE) {
      cpuRejected = true;
    }
  }
  assert.strictEqual(cpuRejected, true, 'CPU above ceiling must be rejected');

  let memRejected = false;
  try {
    validateResourceCeilings({ cpuMilli: 1000, memoryMiB: 4096 });
  } catch (err) {
    if (err instanceof EngineError && err.code === StudioErrorCode.RESOURCE_LIMIT_UNENFORCEABLE) {
      memRejected = true;
    }
  }
  assert.strictEqual(memRejected, true, 'Memory above ceiling must be rejected');
  console.log('[TEST] PASS: Resource ceilings enforced (max 2 CPUs, 3 GiB RAM)');

  // 2. Engine Discovery
  console.log('[TEST] 2. Verifying Engine Discovery');
  const discovered = await discoverEngine();
  console.log(`[TEST] Discovered engine type: ${discovered.engineType}, endpoint: ${discovered.endpoint}`);
  assert.ok(discovered.endpoint, 'Engine endpoint must be discovered');
  assert.ok(discovered.cliPath, 'CLI path must be resolved');
  console.log('[TEST] PASS: Engine discovered successfully');

  const cliAdapter = new DockerCliAdapter({
    cliPath: discovered.cliPath,
    engineType: discovered.engineType,
  });

  const httpAdapter = new DockerHttpAdapter({
    socketPath: discovered.transport === 'socket' ? discovered.endpoint : undefined,
    engineType: discovered.engineType,
  });

  // 3. Engine Probe
  console.log('[TEST] 3. Verifying Engine Probe (CLI and HTTP)');
  const cliCaps = await cliAdapter.probe();
  console.log(`[TEST] CLI Probe: version=${cliCaps.version}, os=${cliCaps.os}, arch=${cliCaps.arch}, cgroup=${cliCaps.cgroupVersion}`);
  assert.ok(cliCaps.version, 'CLI probe must report version');
  assert.ok(cliCaps.supportsCpuLimits, 'CLI probe must confirm CPU limit support');

  const httpCaps = await httpAdapter.probe();
  console.log(`[TEST] HTTP Probe: version=${httpCaps.version}, apiVersion=${httpCaps.apiVersion}`);
  assert.ok(httpCaps.version, 'HTTP probe must report version');
  assert.ok(httpCaps.apiVersion, 'HTTP probe must report apiVersion');
  console.log('[TEST] PASS: Probe succeeded on both CLI and HTTP transports');

  // 4. Volume Creation & Label Verification
  console.log(`[TEST] 4. Ensuring volume with labels: ${TEST_VOLUME_NAME}`);
  const vol = await cliAdapter.ensureVolume({
    name: TEST_VOLUME_NAME,
    installationId: TEST_INSTALLATION_ID,
    role: 'chapter',
    chapterId: TEST_CHAPTER_ID,
  });
  assert.strictEqual(vol.name, TEST_VOLUME_NAME);
  assert.strictEqual(vol.labels[STUDIO_LABEL_KEYS.MANAGED], 'true');
  assert.strictEqual(vol.labels[STUDIO_LABEL_KEYS.INSTALLATION], TEST_INSTALLATION_ID);
  assert.strictEqual(vol.labels[STUDIO_LABEL_KEYS.ROLE], 'chapter');
  assert.strictEqual(vol.labels[STUDIO_LABEL_KEYS.CHAPTER], TEST_CHAPTER_ID);
  console.log('[TEST] PASS: Volume ensured with required Studio labels');

  // 5. Container Creation with Resource Enforcement & Studio Labels
  console.log(`[TEST] 5. Creating container with labels & ceilings: ${TEST_CONTAINER_NAME}`);
  const containerId = await cliAdapter.createContainer({
    name: TEST_CONTAINER_NAME,
    image: 'alpine:latest',
    installationId: TEST_INSTALLATION_ID,
    chapterId: TEST_CHAPTER_ID,
    role: 'chapter',
    generation: 1,
    resources: {
      cpuMilli: 1000,
      memoryBytes: 512 * 1024 * 1024,
    },
    volumes: [
      {
        source: TEST_VOLUME_NAME,
        target: '/workspace',
        readOnly: false,
      },
    ],
    portBindings: [
      {
        containerPort: 8080,
        hostPort: 0,
        hostIp: '127.0.0.1',
      },
    ],
    command: ['sh', '-c', 'sleep 60'],
  });
  assert.ok(containerId, 'Container ID must be returned');
  console.log(`[TEST] Container created: ID=${containerId.substring(0, 12)}`);

  // 6. Inspect Container via CLI and HTTP
  console.log('[TEST] 6. Inspecting container snapshot (CLI and HTTP)');
  const cliSnap = await cliAdapter.inspectContainer(containerId);
  assert.ok(cliSnap, 'CLI snapshot must exist');
  assert.strictEqual(cliSnap.name, TEST_CONTAINER_NAME);
  assert.strictEqual(cliSnap.installationId, TEST_INSTALLATION_ID);
  assert.strictEqual(cliSnap.chapterId, TEST_CHAPTER_ID);
  assert.strictEqual(cliSnap.role, 'chapter');
  assert.strictEqual(cliSnap.generation, 1);
  assert.strictEqual(cliSnap.labels[STUDIO_LABEL_KEYS.MANAGED], 'true');

  const httpSnap = await httpAdapter.inspectContainer(containerId);
  assert.ok(httpSnap, 'HTTP snapshot must exist');
  assert.strictEqual(httpSnap.name, TEST_CONTAINER_NAME);
  assert.strictEqual(httpSnap.installationId, TEST_INSTALLATION_ID);
  assert.strictEqual(httpSnap.chapterId, TEST_CHAPTER_ID);
  console.log('[TEST] PASS: Container inspection and normalization verified on both transports');

  // 7. Label Filtering with listOwned
  console.log('[TEST] 7. Verifying label filtering with listOwned');
  const owned = await cliAdapter.listOwned(TEST_INSTALLATION_ID);
  const found = owned.find((c) => c.name === TEST_CONTAINER_NAME);
  assert.ok(found, 'Created container must appear in listOwned for matching installation');

  const otherOwned = await cliAdapter.listOwned('non-existent-installation-id');
  assert.strictEqual(otherOwned.length, 0, 'No containers must appear for mismatched installation');
  console.log('[TEST] PASS: Label filtering correctly isolates installations');

  // 8. Start Container & Ephemeral Port Inspection
  console.log('[TEST] 8. Starting container');
  await cliAdapter.startContainer(containerId);
  const runningSnap = await cliAdapter.inspectContainer(containerId);
  assert.ok(runningSnap, 'Snapshot must exist');
  assert.strictEqual(runningSnap.state, 'RUNNING');
  assert.ok(typeof runningSnap.assignedEphemeralPort === 'number');
  assert.ok(runningSnap.assignedEphemeralPort > 0);
  console.log(`[TEST] PASS: Container is RUNNING with ephemeral port ${runningSnap.assignedEphemeralPort}`);

  // 9. Stop Container
  console.log('[TEST] 9. Stopping container with 5s grace period');
  await cliAdapter.stopContainer(containerId, 5);
  const stoppedSnap = await cliAdapter.inspectContainer(containerId);
  assert.ok(stoppedSnap, 'Snapshot must exist');
  assert.strictEqual(stoppedSnap.state, 'STOPPED');
  console.log('[TEST] PASS: Container stopped cleanly');

  // 10. Clean up Container and Volume
  console.log('[TEST] 10. Cleaning up managed container and volume');
  await cliAdapter.removeContainer(containerId);
  const removedSnap = await cliAdapter.inspectContainer(containerId);
  assert.strictEqual(removedSnap, null, 'Container must be null after removal');

  await cliAdapter.removeVolume(TEST_VOLUME_NAME);
  console.log('[TEST] PASS: Managed container and volume cleaned up safely');

  console.log('[TEST] ALL ENGINE ADAPTER AND CONTRACT VERIFICATIONS PASSED SUCCESSFULLY');
}

runVerification().catch((err) => {
  console.error('[TEST ERROR] Verification failed:', err);
  process.exit(1);
});
