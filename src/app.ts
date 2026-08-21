import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';

import authRoutes from './modules/auth/auth.routes';
import schoolsRoutes from './modules/schools/schools.routes';
import eventsRoutes from './modules/disaster-events/events.routes';
import adminRoutes from './modules/admin/admin.routes';
import announcementsRoutes from './modules/announcements/announcements.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import chatRoutes from './modules/chat/chat.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser tools (no Origin header) and any configured origin.
        if (!origin || env.webOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Not allowed by CORS'));
      },
      credentials: true
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/schools', schoolsRoutes);
  app.use('/api/v1/events', eventsRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/announcements', announcementsRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/chat', chatRoutes);

  // Centralized error handler — never leak stack traces to the client.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(err.status ?? 500).json({ error: 'An unexpected error occurred.' });
  });

  return app;
}
