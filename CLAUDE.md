# Claude Development Guide

## Repository Purpose

This is a fork of [andyaiken/forgesteel](https://github.com/andyaiken/forgesteel) that adds shared server functionality. The upstream repo is a hero builder app for DRAW STEEL; this fork extends it with multiplayer/group server capabilities.

## Branch Strategy

- **`server`** - Our main development branch containing server additions
- **`upstream/main`** - Tracks the original forgesteel repository

All server-related development happens on the `server` branch. Periodically merge from `upstream/main` to stay current with upstream changes.

## Project Structure

Server-specific code lives in the `server/` directory:
- `server/` - Node.js/Express server with WebSocket support and Discord OAuth
- `Dockerfile.client`, `Dockerfile.server` - Container configurations
- `docker-compose.yml` - Multi-container orchestration
- `Caddyfile` - Reverse proxy configuration

## Development Guidelines

1. **Keep changes additive** - Avoid modifying upstream files when possible. Extend rather than replace.

2. **Isolate server code** - New server functionality belongs in `server/`. This minimizes merge conflicts.

3. **Preserve merge compatibility** - Before modifying any file that exists upstream, consider whether the change will conflict with future upstream merges.

## Merging from Upstream

```bash
git fetch upstream
git merge upstream/main
```

Resolve any conflicts carefully, prioritizing upstream changes for core app functionality while preserving server integrations.

## Running Locally

Client: `npm install && npm run start` (serves at localhost:5173)

Server: See `server/readme.md` for Discord OAuth setup, then:
```bash
cd server
npm install
npm run dev
```
