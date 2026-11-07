/**
 * Automated End-to-End Orchestrator Lifecycle Test
 */

const http = require('http');
const { startOrchestratorServer } = require('../dist/server');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

function post(url, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('[E2E TEST] Starting test orchestrator on port 18095...');
  const gateway = await startOrchestratorServer({ port: 18095 });

  try {
    // 1. Verify health
    console.log('[E2E TEST] Checking live probe...');
    const live = await get('http://127.0.0.1:18095/orchestrator/health/live');
    if (live.status !== 200 || live.body.status !== 'live') {
      throw new Error(`Live probe failed: ${JSON.stringify(live)}`);
    }
    console.log('[E2E TEST] [PASS] Live probe healthy.');

    // 2. Verify chapters
    console.log('[E2E TEST] Listing chapters...');
    const chRes = await get('http://127.0.0.1:18095/orchestrator/v1/chapters');
    if (chRes.status !== 200 || !chRes.body.chapters || chRes.body.chapters.length < 2) {
      throw new Error(`Chapters list failed: ${JSON.stringify(chRes)}`);
    }
    console.log(`[E2E TEST] [PASS] Found ${chRes.body.chapters.length} chapters.`);
    for (const c of chRes.body.chapters) {
      console.log(`   * ${c.id}: ${c.title} [${c.state || 'NOT_STARTED'}]`);
    }

    // 3. Verify single-active rule launch Chapter 1 (rag-intro)
    console.log('[E2E TEST] Launching Chapter 1 (rag-intro)...');
    const launch1 = await post('http://127.0.0.1:18095/orchestrator/v1/chapters/rag-intro/launch');
    if (launch1.status !== 200) {
      throw new Error(`Launch Chapter 1 failed: ${JSON.stringify(launch1)}`);
    }
    console.log(`[E2E TEST] [PASS] Chapter 1 launched: port=${launch1.body.port}, sessionUrl=${launch1.body.sessionUrl}`);

    // Check state
    const state1 = await get('http://127.0.0.1:18095/orchestrator/v1/state');
    if (state1.body.activeChapterId !== 'rag-intro') {
      throw new Error(`Expected activeChapterId to be rag-intro, got ${state1.body.activeChapterId}`);
    }
    console.log('[E2E TEST] [PASS] State verified: Chapter 1 is active.');

    // 4. Verify launch Chapter 2 (mcp-agentic) automatically stops Chapter 1
    console.log('[E2E TEST] Switching to Chapter 2 (mcp-agentic)...');
    const launch2 = await post('http://127.0.0.1:18095/orchestrator/v1/chapters/mcp-agentic/launch');
    if (launch2.status !== 200) {
      throw new Error(`Launch Chapter 2 failed: ${JSON.stringify(launch2)}`);
    }
    console.log(`[E2E TEST] [PASS] Chapter 2 launched: port=${launch2.body.port}, sessionUrl=${launch2.body.sessionUrl}`);

    const state2 = await get('http://127.0.0.1:18095/orchestrator/v1/state');
    if (state2.body.activeChapterId !== 'mcp-agentic') {
      throw new Error(`Expected activeChapterId to be mcp-agentic, got ${state2.body.activeChapterId}`);
    }
    console.log('[E2E TEST] [PASS] State verified: Chapter 2 is active, Chapter 1 stopped.');

    // 5. Clean teardown: Stop Chapter 2
    console.log('[E2E TEST] Stopping Chapter 2...');
    const stopRes = await post('http://127.0.0.1:18095/orchestrator/v1/chapters/mcp-agentic/stop');
    if (stopRes.status !== 200) {
      throw new Error(`Stop Chapter 2 failed: ${JSON.stringify(stopRes)}`);
    }
    console.log('[E2E TEST] [PASS] Chapter 2 stopped cleanly.');

    console.log('\n========================================================');
    console.log(' ALL END-TO-END ORCHESTRATION TESTS PASSED (100%)');
    console.log('========================================================\n');
  } finally {
    await gateway.stop();
  }
}

run().catch(err => {
  console.error('[E2E TEST] Test failed:', err);
  process.exit(1);
});

