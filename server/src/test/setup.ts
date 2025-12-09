import { beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Create a test database path
const testDbPath = path.join(__dirname, '..', '..', 'test-data', 'test.db');

// Clean up test database before each test
beforeEach(() => {
	// Remove test database if it exists
	if (fs.existsSync(testDbPath)) {
		fs.unlinkSync(testDbPath);
	}
	// Ensure test-data directory exists
	const testDataDir = path.dirname(testDbPath);
	if (!fs.existsSync(testDataDir)) {
		fs.mkdirSync(testDataDir, { recursive: true });
	}
});

// Clean up after all tests
afterAll(() => {
	if (fs.existsSync(testDbPath)) {
		fs.unlinkSync(testDbPath);
	}
});

// Export test database helper
export function createTestDatabase(): Database.Database {
	// Use in-memory database for tests (faster and isolated)
	const db = new Database(':memory:');
	
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
	
	return db;
}

export { testDbPath };

