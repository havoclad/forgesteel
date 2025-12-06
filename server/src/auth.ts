import jwt from 'jsonwebtoken';

// Configuration from environment
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:5173/auth/callback';
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

// Discord API response types
export interface DiscordUser {
	id: string;
	username: string;
	discriminator: string;
	avatar: string | null;
	email?: string;
	global_name?: string;
}

// Our user payload for JWT
export interface UserPayload {
	id: string; // Discord user ID
	username: string; // Discord username
	displayName: string; // global_name or username
	avatar: string | null;
}

// Session payload includes JWT claims
export interface SessionPayload extends UserPayload {
	iat: number;
	exp: number;
}

/**
 * Exchange Discord authorization code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
	const response = await fetch('https://discord.com/api/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: DISCORD_CLIENT_ID,
			client_secret: DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: DISCORD_REDIRECT_URI
		})
	});

	if (!response.ok) {
		const error = await response.text();
		console.error('Discord token exchange failed:', error);
		throw new Error('Failed to exchange code for token');
	}

	const data = await response.json();
	return data.access_token;
}

/**
 * Fetch user info from Discord API using access token
 */
export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
	const response = await fetch('https://discord.com/api/users/@me', {
		headers: { Authorization: `Bearer ${accessToken}` }
	});

	if (!response.ok) {
		const error = await response.text();
		console.error('Discord user fetch failed:', error);
		throw new Error('Failed to fetch user info');
	}

	return response.json();
}

/**
 * Create a session JWT for the authenticated user
 */
export function createSessionToken(user: UserPayload): string {
	return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify and decode a session JWT
 */
export function verifySessionToken(token: string): SessionPayload {
	return jwt.verify(token, JWT_SECRET) as SessionPayload;
}

/**
 * Build the Discord OAuth authorization URL
 */
export function getDiscordAuthUrl(state?: string): string {
	const params = new URLSearchParams({
		client_id: DISCORD_CLIENT_ID,
		redirect_uri: DISCORD_REDIRECT_URI,
		response_type: 'code',
		scope: 'identify'
	});
	if (state) {
		params.append('state', state);
	}
	return `https://discord.com/oauth2/authorize?${params}`;
}

/**
 * Check if Discord OAuth is configured
 */
export function isAuthConfigured(): boolean {
	return !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && JWT_SECRET);
}
