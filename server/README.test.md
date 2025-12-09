# Server Test Suite

This directory contains the test suite for the Forge Steel room server.

## Running Tests

### Local Development

```bash
cd server
npm install
npm test              # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Run tests with coverage report
```

### Docker

Run tests in a container:

```bash
# From project root
docker-compose -f docker-compose.test.yml up --build
```

Or build and run manually:

```bash
docker build -f Dockerfile.server.test -t forgesteel-server-test .
docker run --rm forgesteel-server-test
```

## Test Structure

- `src/db.test.ts` - Tests for database operations
- `src/auth.test.ts` - Tests for authentication functions
- `src/index.test.ts` - Tests for REST API endpoints
- `src/test/setup.ts` - Test setup and utilities
- `src/test/server-helpers.ts` - Helper functions for creating test servers

## Test Coverage

The test suite covers:

1. **Database Operations** (`db.test.ts`)
   - Game data storage and retrieval
   - Hero claim management
   - Room state management
   - Client name management
   - User management

2. **Authentication** (`auth.test.ts`)
   - JWT token creation and verification
   - Discord OAuth URL generation
   - Auth configuration detection

3. **REST Endpoints** (`index.test.ts`)
   - Health check endpoint
   - Client connection and role assignment
   - Data storage and retrieval
   - Hero claim endpoints
   - Room reset functionality

## Writing New Tests

When adding new features to the server:

1. Create a test file: `src/[feature].test.ts`
2. Use the test utilities from `src/test/` for database and server setup
3. Follow the existing test patterns
4. Ensure tests are isolated and don't depend on external services

## Test Database

Tests use an in-memory SQLite database that is created fresh for each test suite. The database is automatically cleaned up after tests complete.

## Environment Variables

Tests use default test values for environment variables. If you need to test with specific configurations, set them in your test file:

```typescript
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
  process.env.DISCORD_CLIENT_ID = '';
});
```

