import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionSettings } from '@/models/connection-settings';
import { HeroClaim } from '@/utils/data-service';

export interface RoomClient {
	id: string;
	role: 'dm' | 'player';
	name: string | null;
	connectedAt: string;
}

export interface DirectorInfo {
	dmClientId: string | null;
	dmIsDiscordUser: boolean;
}

export interface RoomSyncState {
	isConnected: boolean;
	clients: RoomClient[];
	heroClaims: Map<string, string>; // heroId -> clientId
	clientNames: Map<string, string>; // clientId -> name
	lastDataChange: { key: string; version: number } | null;
	directorInfo: DirectorInfo | null;
	authFailed: boolean; // True if WebSocket auth failed (expired/invalid token)
}

interface ClientName {
	clientId: string;
	name: string;
}

interface WebSocketMessage {
	type: string;
	key?: string;
	version?: number;
	heroId?: string;
	clientId?: string | null;
	claims?: HeroClaim[];
	clientNames?: ClientName[];
	clients?: RoomClient[];
	list?: RoomClient[];
	director?: DirectorInfo;
	dmClientId?: string | null;
	dmName?: string | null;
	dmIsDiscordUser?: boolean;
}

export const useRoomSync = (settings: ConnectionSettings) => {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const connectRef = useRef<() => void>(() => {});
	const [ state, setState ] = useState<RoomSyncState>({
		isConnected: false,
		clients: [],
		heroClaims: new Map(),
		clientNames: new Map(),
		lastDataChange: null,
		directorInfo: null,
		authFailed: false
	});
	const hadSuccessfulConnectionRef = useRef(false);

	// Callbacks for data change notifications
	const dataChangeCallbacksRef = useRef<Map<string, () => void>>(new Map());

	const connect = useCallback(() => {
		if (!settings.useRoomServer || !settings.roomServerHost || !settings.clientId) {
			return;
		}

		// Clean up existing connection
		if (wsRef.current) {
			wsRef.current.close();
			wsRef.current = null;
		}

		// Reset successful connection tracker for this new attempt
		hadSuccessfulConnectionRef.current = false;

		try {
			// Convert http:// to ws://
			const wsHost = settings.roomServerHost
				.replace(/^http:\/\//, 'ws://')
				.replace(/^https:\/\//, 'wss://');

			// Use auth token if available, otherwise fall back to clientId
			const wsUrl = settings.authToken
				? `${wsHost}/ws?token=${settings.authToken}`
				: `${wsHost}/ws?clientId=${settings.clientId}`;

			const ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				console.log('Room server WebSocket connected');
				hadSuccessfulConnectionRef.current = true;
				setState(prev => ({ ...prev, isConnected: true, authFailed: false }));
			};

			ws.onmessage = event => {
				try {
					const message: WebSocketMessage = JSON.parse(event.data);

					switch (message.type) {
						case 'init':
							// Initial state from server
							setState(prev => {
								const newClaims = new Map<string, string>();
								message.claims?.forEach(claim => {
									newClaims.set(claim.heroId, claim.clientId);
								});
								const newNames = new Map<string, string>();
								message.clientNames?.forEach(cn => {
									newNames.set(cn.clientId, cn.name);
								});
								return {
									...prev,
									clients: message.clients || [],
									heroClaims: newClaims,
									clientNames: newNames,
									directorInfo: message.director || null
								};
							});
							break;

						case 'data_changed':
							// Data was changed by another client
							setState(prev => ({
								...prev,
								lastDataChange: { key: message.key!, version: message.version! }
							}));
							// Notify registered callbacks
							if (message.key) {
								const callback = dataChangeCallbacksRef.current.get(message.key);
								if (callback) {
									callback();
								}
								// Also notify "all" callbacks
								const allCallback = dataChangeCallbacksRef.current.get('*');
								if (allCallback) {
									allCallback();
								}
							}
							break;

						case 'claim_changed':
							// Hero claim changed
							setState(prev => {
								const newClaims = new Map(prev.heroClaims);
								if (message.clientId) {
									newClaims.set(message.heroId!, message.clientId);
								} else {
									newClaims.delete(message.heroId!);
								}
								return { ...prev, heroClaims: newClaims };
							});
							break;

						case 'clients':
							// Client list updated - also update names from all known clients
							setState(prev => {
								const newNames = new Map(prev.clientNames);
								// Add names from connected clients
								message.list?.forEach(client => {
									if (client.name) {
										newNames.set(client.id, client.name);
									}
								});
								// Add names from full clientNames list (includes disconnected clients)
								message.clientNames?.forEach(cn => {
									newNames.set(cn.clientId, cn.name);
								});
								return {
									...prev,
									clients: message.list || [],
									clientNames: newNames
								};
							});
							break;

						case 'room_reset':
							// Room was reset - clear claims, names, and director
							setState(prev => ({
								...prev,
								heroClaims: new Map(),
								clientNames: new Map(),
								directorInfo: null
							}));
							break;

						case 'director_changed':
							// Director role changed
							setState(prev => ({
								...prev,
								directorInfo: {
									dmClientId: message.dmClientId ?? null,
									dmIsDiscordUser: message.dmIsDiscordUser ?? false
								}
							}));
							break;

						case 'pong':
							// Keepalive response
							break;
					}
				} catch (err) {
					console.error('Error parsing WebSocket message:', err);
				}
			};

			ws.onclose = event => {
				console.log('Room server WebSocket disconnected', event.code, event.reason);
				wsRef.current = null;

				// Check if this was an auth failure (never successfully connected with a token)
				// Close code 1006 is abnormal closure - often happens on auth rejection before upgrade
				const wasAuthAttempt = !!settings.authToken;
				const neverConnected = !hadSuccessfulConnectionRef.current;
				const isAuthFailure = wasAuthAttempt && neverConnected && event.code === 1006;

				if (isAuthFailure) {
					console.warn('WebSocket auth failed - token may be expired');
					setState(prev => ({ ...prev, isConnected: false, authFailed: true }));
					// Don't auto-reconnect with same (expired) token
					return;
				}

				setState(prev => ({ ...prev, isConnected: false }));

				// Attempt to reconnect after 3 seconds for normal disconnects
				if (settings.useRoomServer && settings.clientId) {
					reconnectTimeoutRef.current = setTimeout(() => {
						connectRef.current();
					}, 3000);
				}
			};

			ws.onerror = error => {
				console.error('WebSocket error:', error);
			};

			wsRef.current = ws;
		} catch (err) {
			console.error('Error connecting to WebSocket:', err);
		}
	}, [ settings.useRoomServer, settings.roomServerHost, settings.clientId, settings.authToken ]);

	// Keep connectRef updated with latest connect function
	useEffect(() => {
		connectRef.current = connect;
	}, [ connect ]);

	// Connect when settings change
	useEffect(() => {
		if (settings.useRoomServer && settings.clientId) {
			connect();
		} else {
			// Disconnect if room server is disabled
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
			setState({
				isConnected: false,
				clients: [],
				heroClaims: new Map(),
				clientNames: new Map(),
				lastDataChange: null,
				directorInfo: null,
				authFailed: false
			});
			hadSuccessfulConnectionRef.current = false;
		}

		return () => {
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			if (wsRef.current) {
				wsRef.current.close();
				wsRef.current = null;
			}
		};
	}, [ settings.useRoomServer, settings.clientId, connect ]);

	// Keepalive ping every 30 seconds
	useEffect(() => {
		if (!state.isConnected) return;

		const interval = setInterval(() => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({ type: 'ping' }));
			}
		}, 30000);

		return () => clearInterval(interval);
	}, [ state.isConnected ]);

	// Register callback for data changes
	const onDataChange = useCallback((key: string, callback: () => void) => {
		dataChangeCallbacksRef.current.set(key, callback);
		return () => {
			dataChangeCallbacksRef.current.delete(key);
		};
	}, []);

	// Check if current client owns a hero
	const ownsHero = useCallback((heroId: string) => {
		if (!settings.useRoomServer || !settings.clientId) return true; // Local mode - owns all
		const claimOwner = state.heroClaims.get(heroId);
		return claimOwner === settings.clientId || settings.role === 'dm';
	}, [ settings.useRoomServer, settings.clientId, settings.role, state.heroClaims ]);

	// Check if hero is claimed by anyone
	const getHeroOwner = useCallback((heroId: string) => {
		return state.heroClaims.get(heroId) || null;
	}, [ state.heroClaims ]);

	// Get the display name for a client
	const getClientName = useCallback((clientId: string) => {
		return state.clientNames.get(clientId) || null;
	}, [ state.clientNames ]);

	// Get the owner's name for a hero
	const getHeroOwnerName = useCallback((heroId: string) => {
		const ownerId = state.heroClaims.get(heroId);
		if (!ownerId) return null;
		return state.clientNames.get(ownerId) || null;
	}, [ state.heroClaims, state.clientNames ]);

	// Check if current user can edit a hero
	const canEditHero = useCallback((heroId: string) => {
		if (!settings.useRoomServer) return true; // Local mode - can edit all
		if (settings.role === 'dm') return true; // DM can edit all
		const owner = state.heroClaims.get(heroId);
		return owner === settings.clientId; // Player can only edit their own claimed heroes
	}, [ settings.useRoomServer, settings.role, settings.clientId, state.heroClaims ]);

	// Check if current user can claim the director role
	// Can claim if: authenticated with Discord, not already DM, and current DM is not a Discord user
	const canClaimDirector = useCallback(() => {
		if (!settings.useRoomServer) return false;
		if (!settings.authToken) return false; // Must be Discord-authenticated
		if (settings.role === 'dm') return false; // Already the director
		if (!state.directorInfo) return true; // No director info means we might be able to claim
		if (state.directorInfo.dmIsDiscordUser) return false; // Can't claim from another Discord user
		return true; // Current director is not a Discord user, can claim
	}, [ settings.useRoomServer, settings.authToken, settings.role, state.directorInfo ]);

	return {
		...state,
		onDataChange,
		ownsHero,
		getHeroOwner,
		getClientName,
		getHeroOwnerName,
		canEditHero,
		canClaimDirector,
		isDm: settings.role === 'dm',
		clientId: settings.clientId
	};
};
