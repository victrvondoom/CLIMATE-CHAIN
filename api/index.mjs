// Vercel serverless entry: serves every /api/* request through the Climate Chain gateway.
// Importing gateway.mjs builds the request handler without binding a port (it only listens when run directly).
import { createGatewayServer } from '../climate-chain/gateway/gateway.mjs';

const server = createGatewayServer();

export default function handler(req, res) {
  server.emit('request', req, res);
}
