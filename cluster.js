import cluster from 'node:cluster';
import os from 'node:os';

/**
 * Cluster entry point — forks one worker per CPU core.
 * 
 * Each worker runs its own Express server sharing the same port
 * via the kernel's SO_REUSEPORT / round-robin scheduling.
 * 
 * On an 8-core machine, this alone gives ~8x throughput.
 * 
 * Usage:
 *   npm run cluster
 *   # or: node cluster.js
 */

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[Cluster] Primary process ${process.pid} starting ${numCPUs} workers...`);

  // Fork one worker per CPU core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({ IS_CLUSTER_WORKER: 'true' });
  }

  // Auto-restart crashed workers
  cluster.on('exit', (worker, code, signal) => {
    console.log(`[Cluster] Worker ${worker.process.pid} exited (code: ${code}, signal: ${signal})`);
    if (code !== 0 && !worker.exitedAfterDisconnect) {
      console.log('[Cluster] Restarting a replacement worker...');
      cluster.fork({ IS_CLUSTER_WORKER: 'true' });
    }
  });

  cluster.on('online', (worker) => {
    console.log(`[Cluster] Worker ${worker.process.pid} is online`);
  });

  // Graceful shutdown: send SIGTERM to all workers
  const shutdown = () => {
    console.log('[Cluster] Primary received shutdown signal, stopping workers...');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill('SIGTERM');
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  // Worker process: import and start the Express app
  const { startServer } = await import('./index.js');
  await startServer();
}
