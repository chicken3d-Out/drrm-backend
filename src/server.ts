import http from 'http';
import { createApp } from './app';
import { initSocketGateway } from './realtime/socket-gateway';
import { startSyncScheduler } from './jobs/sync-scheduler';
import { env } from './config/env';

const app = createApp();
const httpServer = http.createServer(app);

initSocketGateway(httpServer);

httpServer.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`DepEd Leyte DRRM backend listening on port ${env.port} (${env.nodeEnv})`);
  startSyncScheduler();
});
