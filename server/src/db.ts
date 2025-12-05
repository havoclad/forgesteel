import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'forgesteel.db');

const db = new Database(dbPath);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS game_data (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    version INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS hero_claims (
    hero_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    claimed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS room_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS client_names (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT DEFAULT (datetime('now'))
  );
`);

// Prepared statements for better performance
const getDataStmt = db.prepare('SELECT data, version FROM game_data WHERE key = ?');
const upsertDataStmt = db.prepare(`
  INSERT INTO game_data (key, data, version)
  VALUES (?, ?, 1)
  ON CONFLICT(key) DO UPDATE SET
    data = excluded.data,
    version = version + 1
  RETURNING version
`);
const upsertDataWithVersionStmt = db.prepare(`
  UPDATE game_data
  SET data = ?, version = version + 1
  WHERE key = ? AND version = ?
  RETURNING version
`);

const getClaimStmt = db.prepare('SELECT client_id FROM hero_claims WHERE hero_id = ?');
const getAllClaimsStmt = db.prepare('SELECT hero_id, client_id FROM hero_claims');
const upsertClaimStmt = db.prepare(`
  INSERT INTO hero_claims (hero_id, client_id)
  VALUES (?, ?)
  ON CONFLICT(hero_id) DO UPDATE SET client_id = excluded.client_id
`);
const deleteClaimStmt = db.prepare('DELETE FROM hero_claims WHERE hero_id = ?');
const deleteClaimByOwnerStmt = db.prepare('DELETE FROM hero_claims WHERE hero_id = ? AND client_id = ?');

const getRoomStateStmt = db.prepare('SELECT value FROM room_state WHERE key = ?');
const upsertRoomStateStmt = db.prepare(`
  INSERT INTO room_state (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

const getClientNameStmt = db.prepare('SELECT name FROM client_names WHERE client_id = ?');
const getAllClientNamesStmt = db.prepare('SELECT client_id, name FROM client_names');
const upsertClientNameStmt = db.prepare(`
  INSERT INTO client_names (client_id, name)
  VALUES (?, ?)
  ON CONFLICT(client_id) DO UPDATE SET name = excluded.name
`);

// User statements
const getUserStmt = db.prepare('SELECT id, username, display_name, avatar, created_at, last_login FROM users WHERE id = ?');
const upsertUserStmt = db.prepare(`
  INSERT INTO users (id, username, display_name, avatar)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    username = excluded.username,
    display_name = excluded.display_name,
    avatar = excluded.avatar,
    last_login = datetime('now')
`);

export interface GameData {
  data: string;
  version: number;
}

export interface HeroClaim {
  heroId: string;
  clientId: string;
}

export interface ClientName {
  clientId: string;
  name: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  createdAt?: string;
  lastLogin?: string;
}

export const database = {
  // Game data operations
  getData(key: string): GameData | null {
    const row = getDataStmt.get(key) as { data: string; version: number } | undefined;
    if (!row) return null;
    return { data: row.data, version: row.version };
  },

  setData(key: string, data: string, expectedVersion?: number): { version: number } | null {
    if (expectedVersion !== undefined) {
      // Optimistic locking - only update if version matches
      const result = upsertDataWithVersionStmt.get(data, key, expectedVersion) as { version: number } | undefined;
      if (!result) {
        return null; // Version mismatch
      }
      return { version: result.version };
    }
    // No version check - just upsert
    const result = upsertDataStmt.get(key, data) as { version: number };
    return { version: result.version };
  },

  // Hero claim operations
  getClaim(heroId: string): string | null {
    const row = getClaimStmt.get(heroId) as { client_id: string } | undefined;
    return row?.client_id ?? null;
  },

  getAllClaims(): HeroClaim[] {
    const rows = getAllClaimsStmt.all() as { hero_id: string; client_id: string }[];
    return rows.map(row => ({ heroId: row.hero_id, clientId: row.client_id }));
  },

  setClaim(heroId: string, clientId: string): void {
    upsertClaimStmt.run(heroId, clientId);
  },

  deleteClaim(heroId: string, clientId?: string): boolean {
    if (clientId) {
      // Only delete if owned by this client
      const result = deleteClaimByOwnerStmt.run(heroId, clientId);
      return result.changes > 0;
    }
    // Force delete (for DM)
    const result = deleteClaimStmt.run(heroId);
    return result.changes > 0;
  },

  // Room state operations
  getRoomState(key: string): string | null {
    const row = getRoomStateStmt.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  setRoomState(key: string, value: string): void {
    upsertRoomStateStmt.run(key, value);
  },

  // Get DM client ID
  getDmClientId(): string | null {
    return this.getRoomState('dm_client_id');
  },

  setDmClientId(clientId: string): void {
    this.setRoomState('dm_client_id', clientId);
  },

  // Reset room (clear DM and claims)
  resetRoom(): void {
    db.exec('DELETE FROM hero_claims');
    db.exec('DELETE FROM room_state');
    db.exec('DELETE FROM client_names');
  },

  // Client name operations
  getClientName(clientId: string): string | null {
    const row = getClientNameStmt.get(clientId) as { name: string } | undefined;
    return row?.name ?? null;
  },

  getAllClientNames(): ClientName[] {
    const rows = getAllClientNamesStmt.all() as { client_id: string; name: string }[];
    return rows.map(row => ({ clientId: row.client_id, name: row.name }));
  },

  setClientName(clientId: string, name: string): void {
    upsertClientNameStmt.run(clientId, name);
  },

  // User operations
  getUser(id: string): User | null {
    const row = getUserStmt.get(id) as {
      id: string;
      username: string;
      display_name: string;
      avatar: string | null;
      created_at: string;
      last_login: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar,
      createdAt: row.created_at,
      lastLogin: row.last_login
    };
  },

  upsertUser(user: { id: string; username: string; displayName: string; avatar: string | null }): void {
    upsertUserStmt.run(user.id, user.username, user.displayName, user.avatar);
    // Also update client_names table so display name shows in UI
    upsertClientNameStmt.run(user.id, user.displayName);
  }
};

export default database;
