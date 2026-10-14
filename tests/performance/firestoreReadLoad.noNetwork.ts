import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { vi } from 'vitest';
const forbidden = () => { throw new Error('READ_LOAD_MEASUREMENT_NETWORK_FORBIDDEN'); };
vi.stubGlobal('fetch', forbidden);
vi.stubGlobal('WebSocket', forbidden);
vi.spyOn(http, 'request').mockImplementation(forbidden);
vi.spyOn(http, 'get').mockImplementation(forbidden);
vi.spyOn(https, 'request').mockImplementation(forbidden);
vi.spyOn(https, 'get').mockImplementation(forbidden);
vi.spyOn(tls, 'connect').mockImplementation(forbidden);
const originalConnect = net.Socket.prototype.connect;
vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: Parameters<typeof originalConnect>) {
  // Vitest's local pipe is allowed; every TCP destination (including loopback) is denied.
  const first = args[0] as unknown;
  const path = typeof first === 'string' ? first : first && typeof first === 'object' && 'path' in first ? first.path : null;
  if (typeof path !== 'string' || !path.startsWith('/')) return forbidden();
  return originalConnect.apply(this, args);
});
