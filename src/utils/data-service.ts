import axios, { AxiosError } from 'axios';
import { ConnectionSettings } from '@/models/connection-settings';
import { Hero } from '@/models/hero';
import { Options } from '@/models/options';
import { PatreonSession } from '@/models/patreon-connection';
import { Playbook } from '@/models/playbook';
import { Session } from '@/models/session';
import { Sourcebook } from '@/models/sourcebook';
import localforage from 'localforage';

export interface HeroClaim {
	heroId: string;
	clientId: string;
}

export class DataService {
	settings: ConnectionSettings;
	readonly host: string;
	readonly apiToken: string;
	private jwt: string | null;
	private tokenHandlerHost: string;

	constructor(settings: ConnectionSettings) {
		this.settings = settings;
		this.host = settings.warehouseHost;
		this.apiToken = settings.warehouseToken;
		this.jwt = null;

		// this.tokenHandlerHost = 'http://localhost:5000';
		this.tokenHandlerHost = 'https://forgesteel-warehouse-b7wsk.ondigitalocean.app';
	};

	private getErrorMessage = (error: unknown) => {
		let msg = 'Error communicating with FS Warehouse';
		if (error instanceof AxiosError) {
			msg = `There was a problem with Forge Steel Warehouse: ${error.message}`;
			if (error.response) {
				const code = error.response.status;
				const respMsg = error.response.data.message ?? error.response.data;
				msg = `FS Warehouse Error: [${code}] ${respMsg}`;
			}
		}
		return msg;
	};

	private async ensureJwt() {
		if (this.jwt === null) {
			try {
				const response = await axios.get(`${this.host}/connect`, { headers: { Authorization: `Bearer ${this.apiToken}` } });
				this.jwt = response.data.access_token;
			} catch (error) {
				console.error('Error communicating with FS Warehouse', error);
				throw new Error(this.getErrorMessage(error), { cause: error });
			}
		}

		return this.jwt;
	}

	private getRoomHeaders(includeName = false) {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		// Use Bearer token if authenticated, otherwise fall back to x-client-id
		if (this.settings.authToken) {
			headers['Authorization'] = `Bearer ${this.settings.authToken}`;
		} else {
			headers['x-client-id'] = this.settings.clientId || '';
			if (includeName && this.settings.playerName) {
				headers['x-client-name'] = this.settings.playerName;
			}
		}

		return headers;
	}

	private async getLocalOrWarehouse<T>(key: string): Promise<T | null> {
		if (this.settings.useRoomServer) {
			try {
				const response = await axios.get(`${this.settings.roomServerHost}/data/${key}`, {
					headers: this.getRoomHeaders()
				});
				return response.data.data;
			} catch (error) {
				console.error('Error communicating with Room Server', error);
				throw new Error(this.getRoomErrorMessage(error), { cause: error });
			}
		} else if (this.settings.useWarehouse) {
			await this.ensureJwt();
			try {
				const response = await axios.get(`${this.host}/data/${key}`, {
					headers: { Authorization: `Bearer ${this.jwt}` }
				});
				return response.data.data;
			} catch (error) {
				console.error('Error communicating with FS Warehouse', error);
				throw new Error(this.getErrorMessage(error), { cause: error });
			}
		} else {
			return localforage.getItem<T>(key);
		}
	}

	private async putLocalOrWarehouse<T>(key: string, value: T): Promise<T> {
		if (this.settings.useRoomServer) {
			try {
				await axios.put(`${this.settings.roomServerHost}/data/${key}`,
					{ data: value },
					{ headers: this.getRoomHeaders() }
				);
				return value;
			} catch (error) {
				console.error('Error communicating with Room Server', error);
				throw new Error(this.getRoomErrorMessage(error), { cause: error });
			}
		} else if (this.settings.useWarehouse) {
			await this.ensureJwt();
			try {
				await axios.put(`${this.host}/data/${key}`,
					value, {
						headers: { Authorization: `Bearer ${this.jwt}` }
					});
				return value;
			} catch (error) {
				console.error('Error communicating with FS Warehouse', error);
				throw new Error(this.getErrorMessage(error), { cause: error });
			}
		} else {
			return localforage.setItem<T>(key, value);
		}
	}

	private getRoomErrorMessage = (error: unknown) => {
		let msg = 'Error communicating with Room Server';
		if (error instanceof AxiosError) {
			msg = `Room Server Error: ${error.message}`;
			if (error.response) {
				const code = error.response.status;
				const respMsg = error.response.data?.error ?? error.response.data?.message ?? error.response.data;
				msg = `Room Server Error: [${code}] ${respMsg}`;
			}
		}
		return msg;
	};

	async getOptions(): Promise<Options | null> {
		return localforage.getItem<Options>('forgesteel-options');
	}

	async saveOptions(options: Options): Promise<Options> {
		return localforage.setItem<Options>('forgesteel-options', options);
	}

	async getHeroes(): Promise<Hero[] | null> {
		return this.getLocalOrWarehouse<Hero[]>('forgesteel-heroes');
	};

	async saveHeroes(heroes: Hero[]): Promise<Hero[]> {
		return this.putLocalOrWarehouse<Hero[]>('forgesteel-heroes', heroes);
	}

	async getHomebrew(): Promise<Sourcebook[] | null> {
		return this.getLocalOrWarehouse<Sourcebook[]>('forgesteel-homebrew-settings');
	}

	async saveHomebrew(sourcebooks: Sourcebook[]): Promise<Sourcebook[]> {
		return this.putLocalOrWarehouse<Sourcebook[]>('forgesteel-homebrew-settings', sourcebooks);
	}

	/**
	 * On load will be combined into the homebrew sourcebooks, will eventually be deprecated and removed
	 */
	async getPlaybook(): Promise<Playbook | null> {
		return localforage.getItem<Playbook>('forgesteel-playbook');
	}

	/**
	 * @deprecated Playbook has been combined with homebrew sourcebooks - will eventually be removed
	 */
	async savePlaybook(playbook: Playbook): Promise<Playbook> {
		return localforage.setItem<Playbook>('forgesteel-playbook', playbook);
	}

	async getSession(): Promise<Session | null> {
		return this.getLocalOrWarehouse<Session>('forgesteel-session');
	}

	async saveSession(session: Session): Promise<Session> {
		return this.putLocalOrWarehouse<Session>('forgesteel-session', session);
	}

	async getHiddenSettingIds(): Promise<string[] | null> {
		return this.getLocalOrWarehouse<string[]>('forgesteel-hidden-setting-ids');
	}

	async saveHiddenSettingIds(ids: string[]): Promise<string[]> {
		return this.putLocalOrWarehouse<string[]>('forgesteel-hidden-setting-ids', ids);
	}

	// Room Server specific methods

	async connectToRoomServer(): Promise<{ clientId: string; role: 'dm' | 'player'; name: string | null }> {
		if (!this.settings.useRoomServer) {
			throw new Error('Room server is not enabled');
		}

		try {
			const response = await axios.get(`${this.settings.roomServerHost}/connect`, {
				headers: this.getRoomHeaders(true)
			});
			return {
				clientId: response.data.clientId,
				role: response.data.role,
				name: response.data.name
			};
		} catch (error) {
			console.error('Error connecting to Room Server', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	async getClientNames(): Promise<{ clientId: string; name: string }[]> {
		if (!this.settings.useRoomServer) {
			return [];
		}

		try {
			const response = await axios.get(`${this.settings.roomServerHost}/names`, {
				headers: this.getRoomHeaders()
			});
			return response.data.names || [];
		} catch (error) {
			console.error('Error getting client names', error);
			return [];
		}
	}

	async getHeroClaims(): Promise<HeroClaim[]> {
		if (!this.settings.useRoomServer) {
			return [];
		}

		try {
			const response = await axios.get(`${this.settings.roomServerHost}/claims`, {
				headers: this.getRoomHeaders()
			});
			return response.data.claims || [];
		} catch (error) {
			console.error('Error getting hero claims', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	async claimHero(heroId: string): Promise<boolean> {
		if (!this.settings.useRoomServer) {
			return false;
		}

		try {
			await axios.post(`${this.settings.roomServerHost}/heroes/${heroId}/claim`, {}, {
				headers: this.getRoomHeaders()
			});
			return true;
		} catch (error) {
			if (error instanceof AxiosError && error.response?.status === 409) {
				// Already claimed by someone else
				return false;
			}
			console.error('Error claiming hero', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	async releaseHeroClaim(heroId: string): Promise<boolean> {
		if (!this.settings.useRoomServer) {
			return false;
		}

		try {
			const response = await axios.delete(`${this.settings.roomServerHost}/heroes/${heroId}/claim`, {
				headers: this.getRoomHeaders()
			});
			return response.data.success;
		} catch (error) {
			console.error('Error releasing hero claim', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	async testRoomServerConnection(): Promise<boolean> {
		try {
			const response = await axios.get(`${this.settings.roomServerHost}/health`);
			return response.data.status === 'ok';
		} catch {
			return false;
		}
	}

	// Director role management

	async getDirectorStatus(): Promise<{
		dmClientId: string | null;
		dmName: string | null;
		dmIsDiscordUser: boolean;
		canClaim: boolean;
	}> {
		if (!this.settings.useRoomServer) {
			return { dmClientId: null, dmName: null, dmIsDiscordUser: false, canClaim: false };
		}

		try {
			const response = await axios.get(`${this.settings.roomServerHost}/director/status`, {
				headers: this.getRoomHeaders()
			});
			return response.data;
		} catch (error) {
			console.error('Error getting director status', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	async claimDirectorRole(): Promise<{ success: boolean; role: 'dm' | 'player' }> {
		if (!this.settings.useRoomServer) {
			throw new Error('Room server is not enabled');
		}

		try {
			const response = await axios.post(`${this.settings.roomServerHost}/director/claim`, {}, {
				headers: this.getRoomHeaders()
			});
			return response.data;
		} catch (error) {
			console.error('Error claiming director role', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	async releaseDirectorRole(): Promise<{ success: boolean; role: 'dm' | 'player' }> {
		if (!this.settings.useRoomServer) {
			throw new Error('Room server is not enabled');
		}

		try {
			const response = await axios.post(`${this.settings.roomServerHost}/director/release`, {}, {
				headers: this.getRoomHeaders()
			});
			return response.data;
		} catch (error) {
			console.error('Error releasing director role', error);
			throw new Error(this.getRoomErrorMessage(error), { cause: error });
		}
	}

	// #region Token Handler (Patreon OAuth)
	// login start
	async getPatreonAuthUrl(): Promise<string> {
		const loginStartUrl = `${this.tokenHandlerHost}/th/login/start`;

		try {
			const response = await axios.post(loginStartUrl);
			return response.data.authorizationUrl;
		} catch (error) {
			console.error('Error communicating with Token Handler', error);
			throw new Error(this.getErrorMessage(error), { cause: error });
		}
	}

	// login end
	async finishPatreonLogin(code: string, state: string): Promise<PatreonSession> {
		const loginEndUrl = `${this.tokenHandlerHost}/th/login/end`;
		axios.defaults.withCredentials = true;
		try {
			const response = await axios.post(loginEndUrl, { code: code, state: state });
			const result: PatreonSession = {
				authenticated: false,
				connections: []
			};

			if (response.data) {
				result.authenticated = response.data.authenticated_with_patreon;

				if (response.data.authenticated_with_patreon && response.data.user) {
					result.connections.push({
						name: 'MCDM Patreon',
						status: response.data.user.mcdm
					});
				}
			}

			return result;
		} catch (error) {
			console.error('Error communicating with Token Handler', error);
			throw new Error(this.getErrorMessage(error), { cause: error });
		}
	}

	// session
	async getPatreonSession(): Promise<PatreonSession> {
		const sessionUrl = `${this.tokenHandlerHost}/th/session`;
		axios.defaults.withCredentials = true;
		try {
			const response = await axios.get(sessionUrl);
			const result: PatreonSession = {
				authenticated: false,
				connections: []
			};

			if (response.data) {
				result.authenticated = response.data.authenticated_with_patreon;

				if (response.data.authenticated_with_patreon && response.data.user) {
					result.connections.push({
						name: 'MCDM Patreon',
						status: response.data.user.mcdm
					});
				}
			}

			return result;
		} catch (error) {
			console.error('Error communicating with Token Handler', error);
			throw new Error(this.getErrorMessage(error), { cause: error });
		}
	}

	// logout
	async logoutPatreon(): Promise<undefined> {
		const logoutUrl = `${this.tokenHandlerHost}/th/logout`;
		axios.defaults.withCredentials = true;
		try {
			await axios.post(logoutUrl);
			return;
		} catch (error) {
			console.error('Error communicating with Token Handler', error);
			throw new Error(this.getErrorMessage(error), { cause: error });
		}
	}

	// refresh?
	// #endregion
};
