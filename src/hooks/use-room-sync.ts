import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionSettings } from '@/models/connection-settings';
import { HeroClaim } from '@/utils/data-service';

export interface RoomClient {
	id: string;
	role: 'dm' | 'player';
	connectedAt: string;
}

export interface RoomSyncState {
	isConnected: boolean;
	clients: RoomClient[];
	heroClaims: Map<string, string>; // heroId -> clientId
	lastDataChange: { key: string; version: number } | null;
}

interface WebSocketMessage {
	type: string;
	key?: string;
	version?: number;
	heroId?: string;
	clientId?: string | null;
	claims?: HeroClaim[];
	clients?: RoomClient[];
	list?: RoomClient[];
}

export const useRoomSync = (settings: ConnectionSettings) => {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const [state, setState] = useState<RoomSyncState>({
		isConnected: false,
		clients: [],
		heroClaims: new Map(),
		lastDataChange: null
	});

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

		try {
			// Convert http:// to ws://
			const wsHost = settings.roomServerHost
				.replace(/^http:\/\//, 'ws://')
				.replace(/^https:\/\//, 'wss://');

			const ws = new WebSocket(`${wsHost}/ws?clientId=${settings.clientId}`);

			ws.onopen = () => {
				console.log('Room server WebSocket connected');
				setState(prev => ({ ...prev, isConnected: true }));
			};

			ws.onmessage = (event) => {
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
								return {
									...prev,
									clients: message.clients || [],
									heroClaims: newClaims
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
							// Client list updated
							setState(prev => ({
								...prev,
								clients: message.list || []
							}));
							break;

						case 'room_reset':
							// Room was reset - clear claims
							setState(prev => ({
								...prev,
								heroClaims: new Map()
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

			ws.onclose = () => {
				console.log('Room server WebSocket disconnected');
				setState(prev => ({ ...prev, isConnected: false }));
				wsRef.current = null;

				// Attempt to reconnect after 3 seconds
				if (settings.useRoomServer && settings.clientId) {
					reconnectTimeoutRef.current = setTimeout(() => {
						connect();
					}, 3000);
				}
			};

			ws.onerror = (error) => {
				console.error('WebSocket error:', error);
			};

			wsRef.current = ws;
		} catch (err) {
			console.error('Error connecting to WebSocket:', err);
		}
	}, [settings.useRoomServer, settings.roomServerHost, settings.clientId]);

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
				lastDataChange: null
			});
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
	}, [settings.useRoomServer, settings.clientId, connect]);

	// Keepalive ping every 30 seconds
	useEffect(() => {
		if (!state.isConnected) return;

		const interval = setInterval(() => {
			if (wsRef.current?.readyState === WebSocket.OPEN) {
				wsRef.current.send(JSON.stringify({ type: 'ping' }));
			}
		}, 30000);

		return () => clearInterval(interval);
	}, [state.isConnected]);

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
	}, [settings.useRoomServer, settings.clientId, settings.role, state.heroClaims]);

	// Check if hero is claimed by anyone
	const getHeroOwner = useCallback((heroId: string) => {
		return state.heroClaims.get(heroId) || null;
	}, [state.heroClaims]);

	// Check if current user can edit a hero
	const canEditHero = useCallback((heroId: string) => {
		if (!settings.useRoomServer) return true; // Local mode - can edit all
		if (settings.role === 'dm') return true; // DM can edit all
		const owner = state.heroClaims.get(heroId);
		return owner === settings.clientId; // Player can only edit their own claimed heroes
	}, [settings.useRoomServer, settings.role, settings.clientId, state.heroClaims]);

	return {
		...state,
		onDataChange,
		ownsHero,
		getHeroOwner,
		canEditHero,
		isDm: settings.role === 'dm',
		clientId: settings.clientId
	};
};
