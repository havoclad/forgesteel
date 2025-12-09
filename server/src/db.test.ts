import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from './test/setup.js';
import Database from 'better-sqlite3';

// We'll need to test the database module, but since it uses a singleton pattern,
// we'll create a test version that uses an in-memory database
function createTestDbModule(db: Database.Database) {
	// Prepared statements
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

	return {
		getData(key: string): { data: string; version: number } | null {
			const row = getDataStmt.get(key) as { data: string; version: number } | undefined;
			if (!row) return null;
			return { data: row.data, version: row.version };
		},

		setData(key: string, data: string, expectedVersion?: number): { version: number } | null {
			if (expectedVersion !== undefined) {
				const result = upsertDataWithVersionStmt.get(data, key, expectedVersion) as { version: number } | undefined;
				if (!result) {
					return null;
				}
				return { version: result.version };
			}
			const result = upsertDataStmt.get(key, data) as { version: number };
			return { version: result.version };
		},

		getClaim(heroId: string): string | null {
			const row = getClaimStmt.get(heroId) as { client_id: string } | undefined;
			return row?.client_id ?? null;
		},

		getAllClaims(): Array<{ heroId: string; clientId: string }> {
			const rows = getAllClaimsStmt.all() as { hero_id: string; client_id: string }[];
			return rows.map(row => ({ heroId: row.hero_id, clientId: row.client_id }));
		},

		setClaim(heroId: string, clientId: string): void {
			upsertClaimStmt.run(heroId, clientId);
		},

		deleteClaim(heroId: string, clientId?: string): boolean {
			if (clientId) {
				const result = deleteClaimByOwnerStmt.run(heroId, clientId);
				return result.changes > 0;
			}
			const result = deleteClaimStmt.run(heroId);
			return result.changes > 0;
		},

		getRoomState(key: string): string | null {
			const row = getRoomStateStmt.get(key) as { value: string } | undefined;
			return row?.value ?? null;
		},

		setRoomState(key: string, value: string): void {
			upsertRoomStateStmt.run(key, value);
		},

		getDmClientId(): string | null {
			return this.getRoomState('dm_client_id');
		},

		isDmDiscordUser(): boolean {
			return this.getRoomState('dm_is_discord_user') === 'true';
		},

		setDmClientId(clientId: string, isDiscordUser: boolean = false): void {
			this.setRoomState('dm_client_id', clientId);
			this.setRoomState('dm_is_discord_user', isDiscordUser ? 'true' : 'false');
		},

		clearDmClientId(): void {
			db.exec('DELETE FROM room_state WHERE key IN (\'dm_client_id\', \'dm_is_discord_user\')');
		},

		resetRoom(): void {
			db.exec('DELETE FROM hero_claims');
			db.exec('DELETE FROM room_state');
			db.exec('DELETE FROM client_names');
		},

		getClientName(clientId: string): string | null {
			const row = getClientNameStmt.get(clientId) as { name: string } | undefined;
			return row?.name ?? null;
		},

		getAllClientNames(): Array<{ clientId: string; name: string }> {
			const rows = getAllClientNamesStmt.all() as { client_id: string; name: string }[];
			return rows.map(row => ({ clientId: row.client_id, name: row.name }));
		},

		setClientName(clientId: string, name: string): void {
			upsertClientNameStmt.run(clientId, name);
		},

		getUser(id: string): {
			id: string;
			username: string;
			displayName: string;
			avatar: string | null;
			createdAt?: string;
			lastLogin?: string;
		} | null {
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
			upsertClientNameStmt.run(user.id, user.displayName);
		}
	};
}

describe('Database Operations', () => {
	let db: Database.Database;
	let testDb: ReturnType<typeof createTestDbModule>;

	beforeEach(() => {
		db = createTestDatabase();
		testDb = createTestDbModule(db);
	});

	describe('Game Data Operations', () => {
		it('should get null for non-existent key', () => {
			const result = testDb.getData('nonexistent');
			expect(result).toBeNull();
		});

		it('should set and get data', () => {
			const testData = JSON.stringify({ test: 'value' });
			const result = testDb.setData('test-key', testData);
			expect(result).toEqual({ version: 1 });

			const retrieved = testDb.getData('test-key');
			expect(retrieved).toEqual({ data: testData, version: 1 });
		});

		it('should increment version on update', () => {
			const testData = JSON.stringify({ test: 'value' });
			testDb.setData('test-key', testData);
			
			const updatedData = JSON.stringify({ test: 'updated' });
			const result = testDb.setData('test-key', updatedData);
			expect(result).toEqual({ version: 2 });

			const retrieved = testDb.getData('test-key');
			expect(retrieved).toEqual({ data: updatedData, version: 2 });
		});

		it('should handle version conflicts', () => {
			const testData = JSON.stringify({ test: 'value' });
			testDb.setData('test-key', testData);
			
			// Try to update with wrong version
			const updatedData = JSON.stringify({ test: 'updated' });
			const result = testDb.setData('test-key', updatedData, 5); // Wrong version
			expect(result).toBeNull();

			// Original data should still be there
			const retrieved = testDb.getData('test-key');
			expect(retrieved).toEqual({ data: testData, version: 1 });
		});

		it('should update successfully with correct version', () => {
			const testData = JSON.stringify({ test: 'value' });
			testDb.setData('test-key', testData);
			
			const updatedData = JSON.stringify({ test: 'updated' });
			const result = testDb.setData('test-key', updatedData, 1); // Correct version
			expect(result).toEqual({ version: 2 });

			const retrieved = testDb.getData('test-key');
			expect(retrieved).toEqual({ data: updatedData, version: 2 });
		});
	});

	describe('Hero Claim Operations', () => {
		it('should return null for unclaimed hero', () => {
			const result = testDb.getClaim('hero-1');
			expect(result).toBeNull();
		});

		it('should set and get claim', () => {
			testDb.setClaim('hero-1', 'client-1');
			const result = testDb.getClaim('hero-1');
			expect(result).toBe('client-1');
		});

		it('should update claim', () => {
			testDb.setClaim('hero-1', 'client-1');
			testDb.setClaim('hero-1', 'client-2');
			const result = testDb.getClaim('hero-1');
			expect(result).toBe('client-2');
		});

		it('should get all claims', () => {
			testDb.setClaim('hero-1', 'client-1');
			testDb.setClaim('hero-2', 'client-2');
			const claims = testDb.getAllClaims();
			expect(claims).toHaveLength(2);
			expect(claims).toContainEqual({ heroId: 'hero-1', clientId: 'client-1' });
			expect(claims).toContainEqual({ heroId: 'hero-2', clientId: 'client-2' });
		});

		it('should delete claim', () => {
			testDb.setClaim('hero-1', 'client-1');
			const deleted = testDb.deleteClaim('hero-1');
			expect(deleted).toBe(true);
			expect(testDb.getClaim('hero-1')).toBeNull();
		});

		it('should only delete claim if owned by client', () => {
			testDb.setClaim('hero-1', 'client-1');
			const deleted = testDb.deleteClaim('hero-1', 'client-2');
			expect(deleted).toBe(false);
			expect(testDb.getClaim('hero-1')).toBe('client-1');
		});

		it('should delete claim if owned by client', () => {
			testDb.setClaim('hero-1', 'client-1');
			const deleted = testDb.deleteClaim('hero-1', 'client-1');
			expect(deleted).toBe(true);
			expect(testDb.getClaim('hero-1')).toBeNull();
		});
	});

	describe('Room State Operations', () => {
		it('should get and set room state', () => {
			testDb.setRoomState('test-key', 'test-value');
			const result = testDb.getRoomState('test-key');
			expect(result).toBe('test-value');
		});

		it('should handle DM client ID', () => {
			testDb.setDmClientId('dm-client-1', false);
			expect(testDb.getDmClientId()).toBe('dm-client-1');
			expect(testDb.isDmDiscordUser()).toBe(false);

			testDb.setDmClientId('dm-client-2', true);
			expect(testDb.getDmClientId()).toBe('dm-client-2');
			expect(testDb.isDmDiscordUser()).toBe(true);
		});

		it('should clear DM client ID', () => {
			testDb.setDmClientId('dm-client-1', false);
			testDb.clearDmClientId();
			expect(testDb.getDmClientId()).toBeNull();
			expect(testDb.isDmDiscordUser()).toBe(false);
		});

		it('should reset room', () => {
			testDb.setClaim('hero-1', 'client-1');
			testDb.setRoomState('test-key', 'test-value');
			testDb.setClientName('client-1', 'Test Client');
			testDb.setDmClientId('dm-client-1', false);

			testDb.resetRoom();

			expect(testDb.getAllClaims()).toHaveLength(0);
			expect(testDb.getRoomState('test-key')).toBeNull();
			expect(testDb.getDmClientId()).toBeNull();
			expect(testDb.getAllClientNames()).toHaveLength(0);
		});
	});

	describe('Client Name Operations', () => {
		it('should set and get client name', () => {
			testDb.setClientName('client-1', 'Test Client');
			const result = testDb.getClientName('client-1');
			expect(result).toBe('Test Client');
		});

		it('should get all client names', () => {
			testDb.setClientName('client-1', 'Client 1');
			testDb.setClientName('client-2', 'Client 2');
			const names = testDb.getAllClientNames();
			expect(names).toHaveLength(2);
			expect(names).toContainEqual({ clientId: 'client-1', name: 'Client 1' });
			expect(names).toContainEqual({ clientId: 'client-2', name: 'Client 2' });
		});

		it('should update client name', () => {
			testDb.setClientName('client-1', 'Old Name');
			testDb.setClientName('client-1', 'New Name');
			const result = testDb.getClientName('client-1');
			expect(result).toBe('New Name');
		});
	});

	describe('User Operations', () => {
		it('should return null for non-existent user', () => {
			const result = testDb.getUser('user-1');
			expect(result).toBeNull();
		});

		it('should upsert and get user', () => {
			const user = {
				id: 'user-1',
				username: 'testuser',
				displayName: 'Test User',
				avatar: 'avatar-url'
			};
			testDb.upsertUser(user);
			const result = testDb.getUser('user-1');
			expect(result).not.toBeNull();
			expect(result?.id).toBe('user-1');
			expect(result?.username).toBe('testuser');
			expect(result?.displayName).toBe('Test User');
			expect(result?.avatar).toBe('avatar-url');
		});

		it('should update client name when upserting user', () => {
			const user = {
				id: 'user-1',
				username: 'testuser',
				displayName: 'Test User',
				avatar: 'avatar-url'
			};
			testDb.upsertUser(user);
			const clientName = testDb.getClientName('user-1');
			expect(clientName).toBe('Test User');
		});
	});
});

