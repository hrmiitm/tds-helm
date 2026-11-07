/**
 * Studio Universal Orchestrator - Gateway & Reverse Proxy Server
 * Reference: upgrade.md Sections 5, 6.1-6.4
 */

import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import express, { Request, Response } from 'express';
import { StateManager } from '../core/stateManager';
import { CatalogService } from '../catalog/catalogService';
import { OperationManager } from '../core/operations';
import { EngineAdapter } from '../engine/engineAdapter';
import { EngineEvent } from '../contracts/types';

export interface GatewayServerOptions {
  port: number;
  bindAddress?: string;
  catalogUiDir: string;
  stateManager: StateManager;
  catalogService: CatalogService;
  operationManager: OperationManager;
  engine: EngineAdapter;
}

export class GatewayServer {
  private app: express.Express;
  private server: http.Server | null = null;
  private port: number;
  private bindAddress: string;
  private catalogUiDir: string;
  private stateManager: StateManager;
  private catalogService: CatalogService;
  private operationManager: OperationManager;
  private engine: EngineAdapter;

  constructor(opts: GatewayServerOptions) {
    this.port = opts.port;
    this.bindAddress = opts.bindAddress || '127.0.0.1';
    this.catalogUiDir = opts.catalogUiDir;
    this.stateManager = opts.stateManager;
    this.catalogService = opts.catalogService;
    this.operationManager = opts.operationManager;
    this.engine = opts.engine;

    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Only parse JSON body for orchestrator control API routes
    this.app.use('/orchestrator', express.json());

    // Health probes
    this.app.get('/orchestrator/health/live', (_req: Request, res: Response) => {
      res.json({ status: 'live', timestamp: new Date().toISOString() });
    });

    this.app.get('/orchestrator/health/ready', (_req: Request, res: Response) => {
      res.json({
        status: 'ready',
        revision: this.stateManager.getRevision(),
        activeChapter: this.stateManager.getActiveChapterId(),
        activeGeneration: this.stateManager.getActiveGeneration(),
      });
    });

    this.app.get('/health/live', (_req: Request, res: Response) => {
      res.json({ status: 'live', timestamp: new Date().toISOString() });
    });

    this.app.get('/health/ready', (req: Request, res: Response) => {
      const activePort = this.stateManager.getActivePort();
      if (!activePort) {
        res.json({
          ready: true,
          status: 'ready',
          revision: this.stateManager.getRevision(),
          activeChapter: null,
        });
        return;
      }
      this.forwardHttpToContainer(req, res, activePort, '/health/ready');
    });

    // Control API: Engine capabilities
    this.app.get('/orchestrator/v1/engine', async (_req: Request, res: Response) => {
      try {
        const caps = await this.engine.probe();
        res.json(caps);
      } catch (err: unknown) {
        res.status(503).json({ error: 'Engine unavailable', details: err instanceof Error ? err.message : String(err) });
      }
    });

    // Control API: State
    this.app.get('/orchestrator/v1/state', (_req: Request, res: Response) => {
      const activeId = this.stateManager.getActiveChapterId();
      const activeGen = this.stateManager.getActiveGeneration();
      res.json({
        activeChapterId: activeId,
        activeGeneration: activeGen,
        activeSnapshot: this.stateManager.getActiveSnapshot(),
        revision: this.stateManager.getRevision(),
        currentOperation: this.operationManager.getActiveOperation(),
        sessionUrl: activeId ? `/s/${activeId}/${activeGen}/` : null,
      });
    });

    // Control API: Cancel Operation
    this.app.post('/orchestrator/v1/operations/:id/cancel', (req: Request, res: Response) => {
      try {
        const opId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        this.operationManager.cancelOperation(opId);
        res.json({ status: 'cancelled', operationId: opId });
      } catch (err: unknown) {
        res.status(400).json({ error: 'Cancel failed', message: err instanceof Error ? err.message : String(err) });
      }
    });

    // Control API: Chapters
    this.app.get('/orchestrator/v1/chapters', (_req: Request, res: Response) => {
      const chapters = this.catalogService.getChapters();
      res.json({
        revision: this.stateManager.getRevision(),
        chapters,
      });
    });

    this.app.get('/orchestrator/v1/chapters/:id', (req: Request, res: Response) => {
      const chapterId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const ch = this.catalogService.getChapter(chapterId);
      if (!ch) {
        res.status(404).json({ error: `Chapter '${chapterId}' not found` });
        return;
      }
      res.json(ch);
    });

    // Control API: Launch Chapter
    this.app.post('/orchestrator/v1/chapters/:id/launch', async (req: Request, res: Response) => {
      const chapterId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const ch = this.catalogService.getChapter(chapterId);
      if (!ch) {
        res.status(404).json({ error: `Chapter '${chapterId}' not found` });
        return;
      }

      const idempotencyKey = req.header('Idempotency-Key') || undefined;

      try {
        const result = await this.stateManager.launchChapter(ch, idempotencyKey);
        res.status(200).json(result);
      } catch (err: unknown) {
        res.status(500).json({ error: 'Launch failed', message: err instanceof Error ? err.message : String(err) });
      }
    });

    // Control API: Stop Chapter
    this.app.post('/orchestrator/v1/chapters/:id/stop', async (req: Request, res: Response) => {
      const chapterId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      try {
        await this.stateManager.stopChapter(chapterId, 15);
        res.json({ status: 'stopped', chapterId });
      } catch (err: unknown) {
        res.status(500).json({ error: 'Stop failed', message: err instanceof Error ? err.message : String(err) });
      }
    });

    // Control API: Reset Confirmation Token
    this.app.post('/orchestrator/v1/chapters/:id/reset-confirmation', (req: Request, res: Response) => {
      const chapterId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const ch = this.catalogService.getChapter(chapterId);
      if (!ch) {
        res.status(404).json({ error: `Chapter '${chapterId}' not found` });
        return;
      }

      const token = this.stateManager.prepareResetConfirmation(chapterId);
      res.json(token);
    });

    // Control API: Execute Reset
    this.app.post('/orchestrator/v1/chapters/:id/reset', async (req: Request, res: Response) => {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: 'Missing required reset confirmation token in body' });
        return;
      }

      try {
        await this.stateManager.executeReset(token);
        res.json({ status: 'reset_complete', chapterId: req.params.id });
      } catch (err: unknown) {
        res.status(500).json({ error: 'Reset failed', message: err instanceof Error ? err.message : String(err) });
      }
    });

    // Control API: Real-time Server-Sent Events (SSE)
    this.app.get('/orchestrator/v1/events', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const lastId = parseInt(req.header('Last-Event-ID') || '0', 10);
      const recent = this.operationManager.getRecentEvents(lastId);

      for (const ev of recent) {
        const seq = ev.actor?.attributes?.sequence || '0';
        res.write(`id: ${seq}\n`);
        res.write(`event: ${ev.action}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }

      const onEvent = (ev: EngineEvent) => {
        const seq = ev.actor?.attributes?.sequence || '0';
        res.write(`id: ${seq}\n`);
        res.write(`event: ${ev.action}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      };

      this.operationManager.on('event', onEvent);

      // Heartbeat every 15 seconds
      const hb = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);

      req.on('close', () => {
        clearInterval(hb);
        this.operationManager.off('event', onEvent);
      });
    });

    // Forward workspace tool traffic to active container if running
    const workspacePrefixes = [
      '/vscode',
      '/jupyter',
      '/browser',
      '/slides',
      '/api',
      '/excalidraw',
      '/preview',
      '/websockify',
    ];

    for (const prefix of workspacePrefixes) {
      this.app.use(prefix, (req: Request, res: Response) => {
        const activePort = this.stateManager.getActivePort();
        if (!activePort) {
          res.status(503).json({ error: 'No active chapter container running' });
          return;
        }

        const targetPath = req.originalUrl || req.url;
        this.forwardHttpToContainer(req, res, activePort, targetPath);
      });
    }

    // Workspace Reverse Proxy: /s/:chapter/:generation/*
    this.app.use('/s/:chapter/:generation', (req: Request, res: Response) => {
      const chapter = Array.isArray(req.params.chapter) ? req.params.chapter[0] : req.params.chapter;
      const generation = Array.isArray(req.params.generation) ? req.params.generation[0] : req.params.generation;
      const activeId = this.stateManager.getActiveChapterId();
      const activeGen = this.stateManager.getActiveGeneration();
      const activePort = this.stateManager.getActivePort();

      if (chapter !== activeId || parseInt(generation, 10) !== activeGen || !activePort) {
        res.status(410).send(`
          <!DOCTYPE html>
          <html>
            <head><title>Session Expired</title></head>
            <body style="font-family:sans-serif;text-align:center;padding:40px;background:#0f172a;color:#f8fafc;">
              <h2>Session Expired or Inactive</h2>
              <p>This chapter workspace is no longer active.</p>
              <a href="/" style="color:#38bdf8;text-decoration:none;font-weight:bold;">Back to Chapter Catalog</a>
            </body>
          </html>
        `);
        return;
      }

      // Proxy request to active container
      const targetPath = req.url || '/';
      this.forwardHttpToContainer(req, res, activePort, targetPath, `/s/${chapter}/${generation}`);
    });

    // Static Assets for Catalog UI
    this.app.use(express.static(this.catalogUiDir));

    // Fallback: serve catalog index.html
    this.app.get('*', (_req: Request, res: Response) => {
      const idx = path.join(this.catalogUiDir, 'index.html');
      if (fs.existsSync(idx)) {
        res.sendFile(idx);
      } else {
        res.status(404).send('Catalog UI not found');
      }
    });
  }

  private forwardHttpToContainer(req: Request, res: Response, targetPort: number, targetPath: string, prefix?: string): void {
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: `127.0.0.1:${targetPort}`,
      'x-forwarded-host': req.headers.host || `127.0.0.1:${this.port}`,
    };
    if (headers.origin) {
      headers.origin = `http://127.0.0.1:${targetPort}`;
    }
    if (prefix) {
      headers['x-forwarded-prefix'] = prefix;
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: targetPath,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Workspace container unreachable', details: err.message });
      }
    });

    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      const data = JSON.stringify(req.body);
      proxyReq.setHeader('content-length', Buffer.byteLength(data));
      proxyReq.write(data);
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  }

  public async start(): Promise<void> {
    await this.stateManager.reconcile();

    this.server = http.createServer(this.app);

    // WebSocket Upgrade Handler for Code-Server, Jupyter & noVNC WebSockets
    this.server.on('upgrade', (req, socket, head) => {
      const url = req.url || '';
      const activePort = this.stateManager.getActivePort();

      if (!activePort) {
        socket.destroy();
        return;
      }

      // Check if URL starts with /s/:chapter/:generation/
      const match = url.match(/^\/s\/([^/]+)\/([^/]+)(\/.*)?$/);
      let targetPath = url;
      if (match) {
        targetPath = match[3] || '/';
      }

      const upstreamSocket = net.connect(activePort, '127.0.0.1', () => {
        // Rewrite the request line to targetPath
        const reqLines = [`${req.method} ${targetPath} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i];
          const val = req.rawHeaders[i + 1];
          if (key.toLowerCase() === 'host') {
            reqLines.push(`Host: 127.0.0.1:${activePort}`);
          } else if (key.toLowerCase() === 'origin') {
            reqLines.push(`Origin: http://127.0.0.1:${activePort}`);
          } else {
            reqLines.push(`${key}: ${val}`);
          }
        }

        upstreamSocket.write(reqLines.join('\r\n') + '\r\n\r\n');
        if (head && head.length > 0) {
          upstreamSocket.write(head);
        }

        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);
      });

      upstreamSocket.on('error', () => {
        socket.destroy();
      });

      socket.on('error', () => {
        upstreamSocket.destroy();
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, this.bindAddress, () => {
        console.log(`[GATEWAY] Studio Universal Gateway listening on http://${this.bindAddress}:${this.port}`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }
}
