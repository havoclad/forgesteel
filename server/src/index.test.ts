import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestServer } from './test/server-helpers.js';
import type { TestServer } from './test/server-helpers.js';

describe('Room Server REST Endpoints', () => {
	let testServer: TestServer;

	beforeEach(async () => {
		// Mock auth configuration
		process.env.DISCORD_CLIENT_ID = '';
		process.env.DISCORD_CLIENT_SECRET = '';
		process.env.JWT_SECRET = 'test-secret';

		testServer = await createTestServer();
		
		// Set up basic routes for testing
		testServer.app.get('/health', (_req, res) => {
			res.json({ status: 'ok', clients: 0, authConfigured: false });
		});

		testServer.app.get('/connect', (req, res) => {
			const clientId = req.headers['x-client-id'] as string || 'test-client-id';
			const clientName = req.headers['x-client-name'] as string | undefined;
			const db = (testServer.app as any).database;
			
			// Determine role
			const dmClientId = db.getDmClientId();
			let role: 'dm' | 'player';
			
			if (!dmClientId) {
				db.setDmClientId(clientId, false);
				role = 'dm';
			} else if (dmClientId === clientId) {
				role = 'dm';
			} else {
				role = 'player';
			}

			if (clientName) {
				db.setClientName(clientId, clientName);
			}

			const name = db.getClientName(clientId);
			res.json({ clientId, role, name });
		});

		testServer.app.get('/data/:key', (req, res) => {
			const { key } = req.params;
			const db = (testServer.app as any).database;
			const result = db.getData(key);

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

		testServer.app.put('/data/:key', (req, res) => {
			const { key } = req.params;
			const { data, expectedVersion } = req.body;
			const clientId = req.headers['x-client-id'] as string | undefined;
			const db = (testServer.app as any).database;

			const dataString = typeof data === 'string' ? data : JSON.stringify(data);
			const result = db.setData(key, dataString, expectedVersion);

			if (!result) {
				const current = db.getData(key);
				res.status(409).json({
					error: 'Version conflict',
					currentVersion: current?.version,
					data: current ? JSON.parse(current.data) : null
				});
				return;
			}

			res.json({ version: result.version });
		});

		testServer.app.get('/claims', (_req, res) => {
			const db = (testServer.app as any).database;
			const claims = db.getAllClaims();
			res.json({ claims });
		});

		testServer.app.post('/heroes/:heroId/claim', (req, res) => {
			const { heroId } = req.params;
			const clientId = req.headers['x-client-id'] as string | undefined;
			const db = (testServer.app as any).database;

			if (!clientId) {
				res.status(400).json({ error: 'Missing authentication' });
				return;
			}

			const existingClaim = db.getClaim(heroId);
			const dmClientId = db.getDmClientId();
			const isDm = clientId === dmClientId;

			if (existingClaim && existingClaim !== clientId && !isDm) {
				res.status(409).json({ error: 'Hero already claimed', claimedBy: existingClaim });
				return;
			}

			db.setClaim(heroId, clientId);
			res.json({ success: true });
		});

		testServer.app.delete('/heroes/:heroId/claim', (req, res) => {
			const { heroId } = req.params;
			const clientId = req.headers['x-client-id'] as string | undefined;
			const db = (testServer.app as any).database;

			if (!clientId) {
				res.status(400).json({ error: 'Missing authentication' });
				return;
			}

			const dmClientId = db.getDmClientId();
			const isDm = clientId === dmClientId;

			const deleted = isDm
				? db.deleteClaim(heroId)
				: db.deleteClaim(heroId, clientId);

			res.json({ success: deleted });
		});

		testServer.app.post('/reset', (req, res) => {
			const clientId = req.headers['x-client-id'] as string | undefined;
			const db = (testServer.app as any).database;
			const dmClientId = db.getDmClientId();

			if (clientId !== dmClientId) {
				res.status(403).json({ error: 'Only DM can reset the room' });
				return;
			}

			db.resetRoom();
			res.json({ success: true });
		});
	});

	afterEach(async () => {
		await testServer.close();
	});

	describe('GET /health', () => {
		it('should return health status', async () => {
			const response = await request(testServer.app)
				.get('/health')
				.expect(200);

			expect(response.body).toHaveProperty('status', 'ok');
			expect(response.body).toHaveProperty('clients');
			expect(response.body).toHaveProperty('authConfigured');
		});
	});

	describe('GET /connect', () => {
		it('should assign DM role to first client', async () => {
			const response = await request(testServer.app)
				.get('/connect')
				.set('x-client-id', 'client-1')
				.expect(200);

			expect(response.body).toHaveProperty('clientId', 'client-1');
			expect(response.body).toHaveProperty('role', 'dm');
		});

		it('should assign player role to subsequent clients', async () => {
			// First client becomes DM
			await request(testServer.app)
				.get('/connect')
				.set('x-client-id', 'client-1')
				.expect(200);

			// Second client becomes player
			const response = await request(testServer.app)
				.get('/connect')
				.set('x-client-id', 'client-2')
				.expect(200);

			expect(response.body).toHaveProperty('clientId', 'client-2');
			expect(response.body).toHaveProperty('role', 'player');
		});

		it('should store and return client name', async () => {
			const response = await request(testServer.app)
				.get('/connect')
				.set('x-client-id', 'client-1')
				.set('x-client-name', 'Test Client')
				.expect(200);

			expect(response.body).toHaveProperty('name', 'Test Client');
		});

		it('should return existing client name if not provided', async () => {
			// First connection sets name
			await request(testServer.app)
				.get('/connect')
				.set('x-client-id', 'client-1')
				.set('x-client-name', 'Test Client')
				.expect(200);

			// Second connection without name should return existing name
			const response = await request(testServer.app)
				.get('/connect')
				.set('x-client-id', 'client-1')
				.expect(200);

			expect(response.body).toHaveProperty('name', 'Test Client');
		});
	});

	describe('GET /data/:key', () => {
		it('should return null for non-existent key', async () => {
			const response = await request(testServer.app)
				.get('/data/nonexistent')
				.expect(200);

			expect(response.body).toEqual({ data: null, version: 0 });
		});

		it('should return data for existing key', async () => {
			const db = (testServer.app as any).database;
			const testData = JSON.stringify({ test: 'value' });
			db.setData('test-key', testData);

			const response = await request(testServer.app)
				.get('/data/test-key')
				.expect(200);

			expect(response.body).toHaveProperty('data');
			expect(response.body.data).toEqual({ test: 'value' });
			expect(response.body).toHaveProperty('version', 1);
		});
	});

	describe('PUT /data/:key', () => {
		it('should save data and return version', async () => {
			const testData = { test: 'value' };
			const response = await request(testServer.app)
				.put('/data/test-key')
				.send({ data: testData })
				.expect(200);

			expect(response.body).toHaveProperty('version', 1);
		});

		it('should increment version on update', async () => {
			const db = (testServer.app as any).database;
			db.setData('test-key', JSON.stringify({ test: 'value' }));

			const response = await request(testServer.app)
				.put('/data/test-key')
				.send({ data: { test: 'updated' } })
				.expect(200);

			expect(response.body).toHaveProperty('version', 2);
		});

		it('should handle version conflicts', async () => {
			const db = (testServer.app as any).database;
			db.setData('test-key', JSON.stringify({ test: 'value' }));

			const response = await request(testServer.app)
				.put('/data/test-key')
				.send({ data: { test: 'updated' }, expectedVersion: 5 })
				.expect(409);

			expect(response.body).toHaveProperty('error', 'Version conflict');
			expect(response.body).toHaveProperty('currentVersion', 1);
		});
	});

	describe('GET /claims', () => {
		it('should return empty array when no claims exist', async () => {
			const response = await request(testServer.app)
				.get('/claims')
				.expect(200);

			expect(response.body).toHaveProperty('claims');
			expect(response.body.claims).toEqual([]);
		});

		it('should return all claims', async () => {
			const db = (testServer.app as any).database;
			db.setClaim('hero-1', 'client-1');
			db.setClaim('hero-2', 'client-2');

			const response = await request(testServer.app)
				.get('/claims')
				.expect(200);

			expect(response.body.claims).toHaveLength(2);
			expect(response.body.claims).toContainEqual({ heroId: 'hero-1', clientId: 'client-1' });
			expect(response.body.claims).toContainEqual({ heroId: 'hero-2', clientId: 'client-2' });
		});
	});

	describe('POST /heroes/:heroId/claim', () => {
		it('should claim hero successfully', async () => {
			const response = await request(testServer.app)
				.post('/heroes/hero-1/claim')
				.set('x-client-id', 'client-1')
				.expect(200);

			expect(response.body).toHaveProperty('success', true);
		});

		it('should reject claim if hero already claimed by another client', async () => {
			const db = (testServer.app as any).database;
			db.setClaim('hero-1', 'client-1');

			const response = await request(testServer.app)
				.post('/heroes/hero-1/claim')
				.set('x-client-id', 'client-2')
				.expect(409);

			expect(response.body).toHaveProperty('error', 'Hero already claimed');
			expect(response.body).toHaveProperty('claimedBy', 'client-1');
		});

		it('should allow DM to claim already claimed hero', async () => {
			const db = (testServer.app as any).database;
			db.setDmClientId('client-dm', false);
			db.setClaim('hero-1', 'client-1');

			const response = await request(testServer.app)
				.post('/heroes/hero-1/claim')
				.set('x-client-id', 'client-dm')
				.expect(200);

			expect(response.body).toHaveProperty('success', true);
		});

		it('should require client ID', async () => {
			const response = await request(testServer.app)
				.post('/heroes/hero-1/claim')
				.expect(400);

			expect(response.body).toHaveProperty('error', 'Missing authentication');
		});
	});

	describe('DELETE /heroes/:heroId/claim', () => {
		it('should delete own claim', async () => {
			const db = (testServer.app as any).database;
			db.setClaim('hero-1', 'client-1');

			const response = await request(testServer.app)
				.delete('/heroes/hero-1/claim')
				.set('x-client-id', 'client-1')
				.expect(200);

			expect(response.body).toHaveProperty('success', true);
		});

		it('should not delete claim owned by another client', async () => {
			const db = (testServer.app as any).database;
			db.setClaim('hero-1', 'client-1');

			const response = await request(testServer.app)
				.delete('/heroes/hero-1/claim')
				.set('x-client-id', 'client-2')
				.expect(200);

			expect(response.body).toHaveProperty('success', false);
		});

		it('should allow DM to delete any claim', async () => {
			const db = (testServer.app as any).database;
			db.setDmClientId('client-dm', false);
			db.setClaim('hero-1', 'client-1');

			const response = await request(testServer.app)
				.delete('/heroes/hero-1/claim')
				.set('x-client-id', 'client-dm')
				.expect(200);

			expect(response.body).toHaveProperty('success', true);
		});
	});

	describe('POST /reset', () => {
		it('should reset room when called by DM', async () => {
			const db = (testServer.app as any).database;
			db.setDmClientId('client-dm', false);
			db.setClaim('hero-1', 'client-1');
			db.setRoomState('test-key', 'test-value');

			const response = await request(testServer.app)
				.post('/reset')
				.set('x-client-id', 'client-dm')
				.expect(200);

			expect(response.body).toHaveProperty('success', true);
			expect(db.getAllClaims()).toHaveLength(0);
			expect(db.getRoomState('test-key')).toBeNull();
		});

		it('should reject reset from non-DM', async () => {
			const db = (testServer.app as any).database;
			db.setDmClientId('client-dm', false);

			const response = await request(testServer.app)
				.post('/reset')
				.set('x-client-id', 'client-player')
				.expect(403);

			expect(response.body).toHaveProperty('error', 'Only DM can reset the room');
		});
	});
});

