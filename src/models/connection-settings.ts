export interface ConnectionSettings {
	useWarehouse: boolean;
	warehouseHost: string;
	warehouseToken: string;

	// Room server settings
	useRoomServer: boolean;
	roomServerHost: string;
	clientId?: string;
	role?: 'dm' | 'player';
	playerName?: string;
}
