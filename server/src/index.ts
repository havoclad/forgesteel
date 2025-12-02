import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { networkInterfaces } from 'os';
import database from './db.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Connected clients
interface Client {
  id: string;
  role: 'dm' | 'player';
  name: string | null;
  ws: WebSocket;
  connectedAt: Date;
}

const clients = new Map<string, Client>();

// Broadcast to all connected clients
function broadcast(message: object, excludeClientId?: string) {
  const data = JSON.stringify(message);
  for (const [clientId, client] of clients) {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

// Broadcast client list to all
function broadcastClientList() {
  const clientList = Array.from(clients.values()).map(c => ({
    id: c.id,
    role: c.role,
    name: c.name,
    connectedAt: c.connectedAt.toISOString()
  }));
  // Include all known names (not just connected clients) so claimed heroes show owner names
  broadcast({ type: 'clients', list: clientList, clientNames: database.getAllClientNames() });
}

// REST Endpoints

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', clients: clients.size });
});

// Connect - get client ID and role
app.get('/connect', (req, res) => {
  const existingClientId = req.headers['x-client-id'] as string | undefined;
  const clientName = req.headers['x-client-name'] as string | undefined;
  let clientId = existingClientId || uuidv4();

  // Determine role
  const dmClientId = database.getDmClientId();
  let role: 'dm' | 'player';

  if (!dmClientId) {
    // First client becomes DM
    database.setDmClientId(clientId);
    role = 'dm';
  } else if (dmClientId === clientId) {
    role = 'dm';
  } else {
    role = 'player';
  }

  // Store/update client name if provided
  if (clientName) {
    database.setClientName(clientId, clientName);
  }

  // Get current name (might have been set previously)
  const name = database.getClientName(clientId);

  res.json({ clientId, role, name });
});

// Get all client names
app.get('/names', (_req, res) => {
  const names = database.getAllClientNames();
  res.json({ names });
});

// Get data by key
app.get('/data/:key', (req, res) => {
  const { key } = req.params;
  const result = database.getData(key);

  if (!result) {
    res.json({ data: null, version: 0 });
    return;
  }

  try {
    res.json({ data: JSON.parse(result.data), version: result.version });
  } catch {
    res.json({ data: result.data, version: result.version });
  }
});

// Save data by key
app.put('/data/:key', (req, res) => {
  const { key } = req.params;
  const { data, expectedVersion } = req.body;
  const clientId = req.headers['x-client-id'] as string | undefined;

  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  const result = database.setData(key, dataString, expectedVersion);

  if (!result) {
    // Version conflict
    const current = database.getData(key);
    res.status(409).json({
      error: 'Version conflict',
      currentVersion: current?.version,
      data: current ? JSON.parse(current.data) : null
    });
    return;
  }

  // Notify other clients
  broadcast({ type: 'data_changed', key, version: result.version }, clientId);

  res.json({ version: result.version });
});

// Get all hero claims
app.get('/claims', (_req, res) => {
  const claims = database.getAllClaims();
  res.json({ claims });
});

// Claim a hero
app.post('/heroes/:heroId/claim', (req, res) => {
  const { heroId } = req.params;
  const clientId = req.headers['x-client-id'] as string;

  if (!clientId) {
    res.status(400).json({ error: 'Missing x-client-id header' });
    return;
  }

  const existingClaim = database.getClaim(heroId);
  const dmClientId = database.getDmClientId();
  const isDm = clientId === dmClientId;

  if (existingClaim && existingClaim !== clientId && !isDm) {
    res.status(409).json({ error: 'Hero already claimed', claimedBy: existingClaim });
    return;
  }

  database.setClaim(heroId, clientId);
  broadcast({ type: 'claim_changed', heroId, clientId });

  res.json({ success: true });
});

// Release a hero claim
app.delete('/heroes/:heroId/claim', (req, res) => {
  const { heroId } = req.params;
  const clientId = req.headers['x-client-id'] as string;

  if (!clientId) {
    res.status(400).json({ error: 'Missing x-client-id header' });
    return;
  }

  const dmClientId = database.getDmClientId();
  const isDm = clientId === dmClientId;

  // DM can release any claim, players can only release their own
  const deleted = isDm
    ? database.deleteClaim(heroId)
    : database.deleteClaim(heroId, clientId);

  if (deleted) {
    broadcast({ type: 'claim_changed', heroId, clientId: null });
  }

  res.json({ success: deleted });
});

// Reset room (DM only)
app.post('/reset', (req, res) => {
  const clientId = req.headers['x-client-id'] as string;
  const dmClientId = database.getDmClientId();

  if (clientId !== dmClientId) {
    res.status(403).json({ error: 'Only DM can reset the room' });
    return;
  }

  database.resetRoom();
  broadcast({ type: 'room_reset' });

  res.json({ success: true });
});

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const clientId = url.searchParams.get('clientId');

  if (!clientId) {
    ws.close(4001, 'Missing clientId');
    return;
  }

  const dmClientId = database.getDmClientId();
  const role: 'dm' | 'player' = clientId === dmClientId ? 'dm' : 'player';
  const name = database.getClientName(clientId);

  const client: Client = {
    id: clientId,
    role,
    name,
    ws,
    connectedAt: new Date()
  };

  clients.set(clientId, client);
  const displayName = name ? `${name} (${clientId.substring(0, 8)}...)` : clientId.substring(0, 8) + '...';
  console.log(`Client connected: ${displayName} (${role})`);

  // Send current claims, client list, and client names
  ws.send(JSON.stringify({
    type: 'init',
    claims: database.getAllClaims(),
    clientNames: database.getAllClientNames(),
    clients: Array.from(clients.values()).map(c => ({
      id: c.id,
      role: c.role,
      name: c.name,
      connectedAt: c.connectedAt.toISOString()
    }))
  }));

  // Notify others of new connection
  broadcastClientList();

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'request_sync': {
          const { key } = data;
          const result = database.getData(key);
          if (result) {
            ws.send(JSON.stringify({
              type: 'sync',
              key,
              data: JSON.parse(result.data),
              version: result.version
            }));
          }
          break;
        }
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
    broadcastClientList();
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${clientId}:`, err);
    clients.delete(clientId);
  });
});

// Get local network addresses
function getNetworkAddresses(): string[] {
  const nets = networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      // Skip internal and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m'
};

// Start server
server.listen(PORT, '0.0.0.0', () => {
  const networkAddresses = getNetworkAddresses();

  console.log();
  console.log(`  ${colors.green}${colors.bold}FORGESTEEL ROOM SERVER${colors.reset}  ${colors.dim}v1.0.0${colors.reset}`);
  console.log();
  console.log(`  ${colors.bold}Local:${colors.reset}      ${colors.cyan}http://localhost:${PORT}${colors.reset}`);

  for (const addr of networkAddresses) {
    console.log(`  ${colors.bold}Network:${colors.reset}    ${colors.cyan}http://${addr}:${PORT}${colors.reset}`);
  }

  console.log();
  console.log(`  ${colors.dim}Clients connect using the Network address above${colors.reset}`);
  console.log(`  ${colors.dim}Press Ctrl+C to stop the server${colors.reset}`);
  console.log();
});
