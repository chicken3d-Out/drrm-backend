import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { verifyAccessToken } from '../modules/auth/auth.service';
import { env } from '../config/env';

// `io` is initialized in initSocketGateway() and exported for use by services
// that need to emit events (e.g. event.service.ts). Until initialized, it's a
// no-op stub so services can import it safely at module-load time.
export let io: Server = new Server();

export function initSocketGateway(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.webOrigins, credentials: true }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required.'));
    try {
      const payload = verifyAccessToken(token);
      (socket as any).userId = payload.sub;
      (socket as any).roles = payload.roles;
      next();
    } catch {
      next(new Error('Invalid or expired token.'));
    }
  });

  io.on('connection', (socket) => {
    const roles: string[] = (socket as any).roles ?? [];
    const userId: string = (socket as any).userId;

    socket.join(`user:${userId}`);
    for (const role of roles) socket.join(`role:${role}`);

    socket.on('chat:message', (payload) => {
      // Broadcast to all connected (approved) users. Persistence handled by
      // the REST endpoint that the client also calls; this is the live-push path.
      io.emit('chat:message', { ...payload, senderId: userId, at: new Date().toISOString() });
    });

    socket.on('chat:typing', () => {
      socket.broadcast.emit('chat:typing', { userId });
    });

    socket.on('disconnect', () => {
      io.emit('chat:user-offline', { userId });
    });

    io.emit('chat:user-online', { userId });
  });

  return io;
}
