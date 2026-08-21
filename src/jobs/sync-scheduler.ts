import cron from 'node-cron';
import { UsgsAdapter } from '../adapters/usgs.adapter';
import { EonetAdapter } from '../adapters/eonet.adapter';
import { FirmsAdapter } from '../adapters/firms.adapter';
import { GdacsAdapter } from '../adapters/gdacs.adapter';
import { PagasaTendayAdapter } from '../adapters/pagasa-tenday.adapter';
import { SourceAdapter } from '../adapters/types';
import { ingestEvents, markSourceSynced } from '../modules/disaster-events/event.service';
import { env } from '../config/env';

const adapters: SourceAdapter[] = [
  new UsgsAdapter(),
  new EonetAdapter(),
  new FirmsAdapter(),
  new GdacsAdapter(),
  new PagasaTendayAdapter()
];

async function runSyncCycle() {
  for (const adapter of adapters) {
    const start = Date.now();
    try {
      const events = await adapter.fetchLatest();
      await ingestEvents(events);
      await markSourceSynced(adapter.name, events.length, undefined, Date.now() - start);
      // eslint-disable-next-line no-console
      console.log(`[sync] ${adapter.name}: ${events.length} event(s) processed.`);
    } catch (err: any) {
      await markSourceSynced(adapter.name, 0, err?.message ?? 'Unknown error', Date.now() - start);
      // eslint-disable-next-line no-console
      console.error(`[sync] ${adapter.name} failed:`, err?.message ?? err);
    }
  }
}

export function startSyncScheduler() {
  const minutes = env.syncIntervalMinutes || 10;
  const cronExpr = `*/${minutes} * * * *`;
  // eslint-disable-next-line no-console
  console.log(`[sync] Scheduler starting — every ${minutes} minute(s).`);
  cron.schedule(cronExpr, runSyncCycle);
  // Run once on boot so the dashboard isn't empty while waiting for the first tick.
  runSyncCycle();
}
