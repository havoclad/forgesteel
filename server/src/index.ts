import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { networkInterfaces } from 'os';
import { Duplex } from 'stream';
import database from './db.js';
import {
  exchangeCodeForToken,
  fetchDiscordUser,
  createSessionToken,
  verifySessionToken,
  getDiscordAuthUrl,
  isAuthConfigured,
  type UserPayload,
  type SessionPayload
} from './auth.js';

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
  res.json({ status: 'ok', clients: clients.size, authConfigured: isAuthConfigured() });
});

// Auth middleware - extracts user from Bearer token
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  try {
    const user = verifySessionToken(authHeader.slice(7));
    (req as any).user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Discord OAuth endpoints

// Get Discord OAuth URL
app.get('/auth/discord/url', (_req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: 'Discord OAuth not configured' });
    return;
  }
  const url = getDiscordAuthUrl();
  res.json({ url });
});

// Exchange Discord code for session token
app.post('/auth/discord', async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).json({ error: 'Discord OAuth not configured' });
    return;
  }

  const { code } = req.body;

  if (!code) {
    res.status(400).json({ error: 'Missing code' });
    return;
  }

  try {
    // Exchange code for Discord access token
    const accessToken = await exchangeCodeForToken(code);

    // Fetch user info from Discord
    const discordUser = await fetchDiscordUser(accessToken);

    // Create user payload
    const user: UserPayload = {
      id: discordUser.id,
      username: discordUser.username,
      displayName: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar,
    };

    // Upsert user in database
    database.upsertUser(user);

    // Create session JWT
    const token = createSessionToken(user);

    res.json({ token, user });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// Verify token and get current user
app.get('/auth/me', requireAuth, (req, res) => {
  const user = (req as any).user as SessionPayload;
  res.json({ user });
});

// Connect - get client ID and role
app.get('/connect', (req, res) => {
  let clientId: string;
  let clientName: string | undefined;
  let isDiscordUser = false;

  // Check for Bearer token auth first
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const user = verifySessionToken(authHeader.slice(7));
      clientId = user.id;
      clientName = user.displayName;
      isDiscordUser = true;
    } catch {
      // Invalid token - fall back to legacy auth
      clientId = (req.headers['x-client-id'] as string) || uuidv4();
      clientName = req.headers['x-client-name'] as string | undefined;
    }
  } else {
    // Legacy auth with x-client-id header
    clientId = (req.headers['x-client-id'] as string) || uuidv4();
    clientName = req.headers['x-client-name'] as string | undefined;
  }

  // Determine role
  const dmClientId = database.getDmClientId();
  let role: 'dm' | 'player';

  if (!dmClientId) {
    // First client becomes DM
    database.setDmClientId(clientId, isDiscordUser);
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

// Director management endpoints

// Get director status
app.get('/director/status', (req, res) => {
  const dmClientId = database.getDmClientId();
  const dmIsDiscordUser = database.isDmDiscordUser();
  const dmName = dmClientId ? database.getClientName(dmClientId) : null;

  // Check if requester can claim
  let canClaim = false;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const user = verifySessionToken(authHeader.slice(7));
      // Can claim if: no DM, or DM is not Discord, and requester is not already DM
      canClaim = (!dmClientId || !dmIsDiscordUser) && user.id !== dmClientId;
    } catch {
      // Invalid token - can't claim
    }
  }

  res.json({ dmClientId, dmName, dmIsDiscordUser, canClaim });
});

// Claim director role (Discord users only, can only claim from non-Discord users)
app.post('/director/claim', requireAuth, (req, res) => {
  const user = (req as any).user as SessionPayload;
  const clientId = user.id;

  const currentDmId = database.getDmClientId();
  const dmIsDiscordUser = database.isDmDiscordUser();

  // Can only claim if no DM or DM is not a Discord user
  if (currentDmId && dmIsDiscordUser) {
    res.status(403).json({ error: 'Director role is held by a Discord user' });
    return;
  }

  // Claim the role
  database.setDmClientId(clientId, true);

  // Update connected client's role if they're connected
  const client = clients.get(clientId);
  if (client) {
    client.role = 'dm';
  }

  // Broadcast director change
  broadcast({
    type: 'director_changed',
    dmClientId: clientId,
    dmName: user.displayName,
    dmIsDiscordUser: true
  });
  broadcastClientList();

  res.json({ success: true, role: 'dm' });
});

// Release director role (current director only)
app.post('/director/release', requireAuth, (req, res) => {
  const user = (req as any).user as SessionPayload;
  const clientId = user.id;

  const currentDmId = database.getDmClientId();

  if (currentDmId !== clientId) {
    res.status(403).json({ error: 'You are not the director' });
    return;
  }

  // Clear the director
  database.clearDmClientId();

  // Update connected client's role
  const client = clients.get(clientId);
  if (client) {
    client.role = 'player';
  }

  // Broadcast director change
  broadcast({
    type: 'director_changed',
    dmClientId: null,
    dmName: null,
    dmIsDiscordUser: false
  });
  broadcastClientList();

  res.json({ success: true, role: 'player' });
});

// Create HTTP server
const server = createServer(app);

// WebSocket server in noServer mode for custom auth handling
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade with JWT verification
server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);

  // Only handle /ws path
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  // Check for auth token
  const token = url.searchParams.get('token');

  // If auth is configured, require token
  if (isAuthConfigured()) {
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const user = verifySessionToken(token);
      (request as any).user = user;
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  } else {
    // Fallback: use clientId query param (for local dev without auth)
    const clientId = url.searchParams.get('clientId');
    if (!clientId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    (request as any).clientId = clientId;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

wss.on('connection', (ws, req) => {
  // Get client identity from auth or fallback
  let clientId: string;
  let name: string | null;

  if ((req as any).user) {
    // Authenticated user
    const user = (req as any).user as SessionPayload;
    clientId = user.id;
    name = user.displayName;
  } else {
    // Fallback to clientId (local dev)
    clientId = (req as any).clientId;
    name = database.getClientName(clientId);
  }

  const dmClientId = database.getDmClientId();
  const role: 'dm' | 'player' = clientId === dmClientId ? 'dm' : 'player';

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

  // Send current claims, client list, client names, and director info
  ws.send(JSON.stringify({
    type: 'init',
    claims: database.getAllClaims(),
    clientNames: database.getAllClientNames(),
    clients: Array.from(clients.values()).map(c => ({
      id: c.id,
      role: c.role,
      name: c.name,
      connectedAt: c.connectedAt.toISOString()
    })),
    director: {
      dmClientId: database.getDmClientId(),
      dmIsDiscordUser: database.isDmDiscordUser()
    }
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
  const authEnabled = isAuthConfigured();

  console.log();
  console.log(`  ${colors.green}${colors.bold}FORGESTEEL ROOM SERVER${colors.reset}  ${colors.dim}v1.0.0${colors.reset}`);
  console.log();
  console.log(`  ${colors.bold}Local:${colors.reset}      ${colors.cyan}http://localhost:${PORT}${colors.reset}`);

  for (const addr of networkAddresses) {
    console.log(`  ${colors.bold}Network:${colors.reset}    ${colors.cyan}http://${addr}:${PORT}${colors.reset}`);
  }

  console.log();
  if (authEnabled) {
    console.log(`  ${colors.green}${colors.bold}Auth:${colors.reset}       ${colors.green}Discord OAuth enabled${colors.reset}`);
  } else {
    console.log(`  ${colors.yellow}${colors.bold}Auth:${colors.reset}       ${colors.yellow}Disabled (set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, JWT_SECRET)${colors.reset}`);
  }
  console.log();
  console.log(`  ${colors.dim}Clients connect using the Network address above${colors.reset}`);
  console.log(`  ${colors.dim}Press Ctrl+C to stop the server${colors.reset}`);
  console.log();
});
