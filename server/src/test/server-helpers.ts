import express, { Express } from 'express';
import { Server } from 'http';
import { WebSocketServer } from 'ws';
import { AddressInfo } from 'net';
import Database from 'better-sqlite3';
import { createTestDatabase } from './setup.js';

export interface TestServer {
	app: Express;
	server: Server;
	wss: WebSocketServer;
	db: Database.Database;
	port: number;
	baseUrl: string;
	close: () => Promise<void>;
}

export async function createTestServer(
	dbOverride?: Database.Database
): Promise<TestServer> {
	const app = express();
	app.use(express.json({ limit: '50mb' }));

	const server = new Server(app);
	const wss = new WebSocketServer({ noServer: true });

	const db = dbOverride || createTestDatabase();

	// Mock database module
	const mockDatabase = {
		getData: (key: string) => {
			const stmt = db.prepare('SELECT data, version FROM game_data WHERE key = ?');
			const row = stmt.get(key) as { data: string; version: number } | undefined;
			return row ? { data: row.data, version: row.version } : null;
		},
		setData: (key: string, data: string, expectedVersion?: number) => {
			if (expectedVersion !== undefined) {
				const stmt = db.prepare(`
					UPDATE game_data
					SET data = ?, version = version + 1
					WHERE key = ? AND version = ?
					RETURNING version
				`);
				const result = stmt.get(data, key, expectedVersion) as { version: number } | undefined;
				return result ? { version: result.version } : null;
			}
			const stmt = db.prepare(`
				INSERT INTO game_data (key, data, version)
				VALUES (?, ?, 1)
				ON CONFLICT(key) DO UPDATE SET
					data = excluded.data,
					version = version + 1
				RETURNING version
			`);
			const result = stmt.get(key, data) as { version: number };
			return { version: result.version };
		},
		getClaim: (heroId: string) => {
			const stmt = db.prepare('SELECT client_id FROM hero_claims WHERE hero_id = ?');
			const row = stmt.get(heroId) as { client_id: string } | undefined;
			return row?.client_id ?? null;
		},
		getAllClaims: () => {
			const stmt = db.prepare('SELECT hero_id, client_id FROM hero_claims');
			const rows = stmt.all() as { hero_id: string; client_id: string }[];
			return rows.map(row => ({ heroId: row.hero_id, clientId: row.client_id }));
		},
		setClaim: (heroId: string, clientId: string) => {
			const stmt = db.prepare(`
				INSERT INTO hero_claims (hero_id, client_id)
				VALUES (?, ?)
				ON CONFLICT(hero_id) DO UPDATE SET client_id = excluded.client_id
			`);
			stmt.run(heroId, clientId);
		},
		deleteClaim: (heroId: string, clientId?: string) => {
			if (clientId) {
				const stmt = db.prepare('DELETE FROM hero_claims WHERE hero_id = ? AND client_id = ?');
				const result = stmt.run(heroId, clientId);
				return result.changes > 0;
			}
			const stmt = db.prepare('DELETE FROM hero_claims WHERE hero_id = ?');
			const result = stmt.run(heroId);
			return result.changes > 0;
		},
		getRoomState: (key: string) => {
			const stmt = db.prepare('SELECT value FROM room_state WHERE key = ?');
			const row = stmt.get(key) as { value: string } | undefined;
			return row?.value ?? null;
		},
		setRoomState: (key: string, value: string) => {
			const stmt = db.prepare(`
				INSERT INTO room_state (key, value)
				VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
			`);
			stmt.run(key, value);
		},
		getDmClientId: () => {
			const stmt = db.prepare('SELECT value FROM room_state WHERE key = ?');
			const row = stmt.get('dm_client_id') as { value: string } | undefined;
			return row?.value ?? null;
		},
		isDmDiscordUser: () => {
			const stmt = db.prepare('SELECT value FROM room_state WHERE key = ?');
			const row = stmt.get('dm_is_discord_user') as { value: string } | undefined;
			return row?.value === 'true';
		},
		setDmClientId: (clientId: string, isDiscordUser: boolean = false) => {
			const stmt1 = db.prepare(`
				INSERT INTO room_state (key, value)
				VALUES (?, ?)
				ON CONFLICT(key) DO UPDATE SET value = excluded.value
			`);
			stmt1.run('dm_client_id', clientId);
			stmt1.run('dm_is_discord_user', isDiscordUser ? 'true' : 'false');
		},
		clearDmClientId: () => {
			db.exec('DELETE FROM room_state WHERE key IN (\'dm_client_id\', \'dm_is_discord_user\')');
		},
		resetRoom: () => {
			db.exec('DELETE FROM hero_claims');
			db.exec('DELETE FROM room_state');
			db.exec('DELETE FROM client_names');
		},
		getClientName: (clientId: string) => {
			const stmt = db.prepare('SELECT name FROM client_names WHERE client_id = ?');
			const row = stmt.get(clientId) as { name: string } | undefined;
			return row?.name ?? null;
		},
		getAllClientNames: () => {
			const stmt = db.prepare('SELECT client_id, name FROM client_names');
			const rows = stmt.all() as { client_id: string; name: string }[];
			return rows.map(row => ({ clientId: row.client_id, name: row.name }));
		},
		setClientName: (clientId: string, name: string) => {
			const stmt = db.prepare(`
				INSERT INTO client_names (client_id, name)
				VALUES (?, ?)
				ON CONFLICT(client_id) DO UPDATE SET name = excluded.name
			`);
			stmt.run(clientId, name);
		},
		getUser: (id: string) => {
			const stmt = db.prepare('SELECT id, username, display_name, avatar, created_at, last_login FROM users WHERE id = ?');
			const row = stmt.get(id) as {
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
		upsertUser: (user: { id: string; username: string; displayName: string; avatar: string | null }) => {
			const stmt = db.prepare(`
				INSERT INTO users (id, username, display_name, avatar)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					username = excluded.username,
					display_name = excluded.display_name,
					avatar = excluded.avatar,
					last_login = datetime('now')
			`);
			stmt.run(user.id, user.username, user.displayName, user.avatar);
			const nameStmt = db.prepare(`
				INSERT INTO client_names (client_id, name)
				VALUES (?, ?)
				ON CONFLICT(client_id) DO UPDATE SET name = excluded.name
			`);
			nameStmt.run(user.id, user.displayName);
		}
	};

	// Store mock database in app for route handlers
	(app as any).database = mockDatabase;

	return new Promise((resolve) => {
		server.listen(0, () => {
			const port = (server.address() as AddressInfo).port;
			const baseUrl = `http://localhost:${port}`;

			resolve({
				app,
				server,
				wss,
				db,
				port,
				baseUrl,
				close: async () => {
					return new Promise<void>((resolveClose) => {
						wss.close();
						server.close(() => {
							db.close();
							resolveClose();
						});
					});
				}
			});
		});
	});
}

