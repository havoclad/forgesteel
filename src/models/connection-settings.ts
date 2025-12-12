export interface AuthenticatedUser {
	id: string;
	username: string;
	displayName: string;
	avatar: string | null;
}

export interface ConnectionSettings {
	useWarehouse: boolean;
	warehouseHost: string;
	warehouseToken: string;
	patreonConnected: boolean;

	// Room server settings
	useRoomServer: boolean;
	roomServerHost: string;
	clientId?: string;
	role?: 'dm' | 'player';
	playerName?: string;

	// Discord OAuth authentication
	authToken?: string;
	authenticatedUser?: AuthenticatedUser;
}
