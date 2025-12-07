import { Alert, Avatar, Button, Flex, Input, Space, Tag } from 'antd';
import { CloudServerOutlined, CrownOutlined, LoginOutlined, LogoutOutlined, SaveFilled, UserOutlined } from '@ant-design/icons';
import { JSX, useEffect, useState } from 'react';
import { ConnectionSettings } from '@/models/connection-settings';
import { DataService } from '@/utils/data-service';
import { HeaderText } from '@/components/controls/header-text/header-text';
import { Toggle } from '@/components/controls/toggle/toggle';
import { Utils } from '@/utils/utils';

interface Props {
	connectionSettings: ConnectionSettings;
	setConnectionSettings: (settings: ConnectionSettings) => void;
}

export const RoomServerSettingsPanel = (props: Props) => {
	const [ connectionSettings, setConnectionSettings ] = useState<ConnectionSettings>(Utils.copy(props.connectionSettings));
	const [ connectionSettingsChanged, setConnectionSettingsChanged ] = useState<boolean>(false);
	const [ testingConnection, setTestingConnection ] = useState<boolean>(false);
	const [ connecting, setConnecting ] = useState<boolean>(false);
	const [ checkingAuth, setCheckingAuth ] = useState<boolean>(false);
	const [ testStatusAlert, setTestStatusAlert ] = useState<JSX.Element | null>(null);
	const [ claimingDirector, setClaimingDirector ] = useState<boolean>(false);
	const [ releasingDirector, setReleasingDirector ] = useState<boolean>(false);
	const [ directorStatus, setDirectorStatus ] = useState<{ canClaim: boolean; dmIsDiscordUser: boolean } | null>(null);

	// Sync local state when props change (e.g., after OAuth callback)
	// Watch specific primitive values to ensure proper change detection
	useEffect(() => {
		setConnectionSettings(Utils.copy(props.connectionSettings));
		setConnectionSettingsChanged(false);
	}, [ props.connectionSettings.authToken, props.connectionSettings.authenticatedUser?.id, props.connectionSettings.clientId, props.connectionSettings.role, props.connectionSettings.roomServerHost ]);

	// Fetch director status when authenticated
	useEffect(() => {
		const fetchDirectorStatus = async () => {
			if (!connectionSettings.authToken || !connectionSettings.roomServerHost || !connectionSettings.useRoomServer) {
				setDirectorStatus(null);
				return;
			}

			try {
				const ds = new DataService(connectionSettings);
				const status = await ds.getDirectorStatus();
				setDirectorStatus({ canClaim: status.canClaim, dmIsDiscordUser: status.dmIsDiscordUser });
			} catch (error) {
				console.error('Error fetching director status:', error);
				setDirectorStatus(null);
			}
		};

		fetchDirectorStatus();
	}, [ connectionSettings.authToken, connectionSettings.roomServerHost, connectionSettings.useRoomServer, connectionSettings.role ]);

	const setUseRoomServer = (value: boolean) => {
		const copy = Utils.copy(connectionSettings);
		copy.useRoomServer = value;
		// Note: We intentionally keep authToken and authenticatedUser when disabling
		// so users don't have to re-authenticate when re-enabling the room server.
		// Use the Sign Out button to explicitly clear authentication.
		setConnectionSettings(copy);
		setConnectionSettingsChanged(true);
	};

	const setRoomServerHost = (value: string) => {
		const copy = Utils.copy(connectionSettings);
		copy.roomServerHost = value;
		setConnectionSettings(copy);
		setConnectionSettingsChanged(true);
	};

	// Normalize the host URL to ensure it has http:// prefix
	const getNormalizedHost = () => {
		let host = connectionSettings.roomServerHost.trim();
		if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
			host = `http://${host}`;
		}
		return host;
	};

	const getSettingsWithNormalizedHost = () => {
		const copy = Utils.copy(connectionSettings);
		copy.roomServerHost = getNormalizedHost();
		return copy;
	};

	const testConnection = async () => {
		setTestingConnection(true);
		setTestStatusAlert(null);

		try {
			const normalizedSettings = getSettingsWithNormalizedHost();
			const ds = new DataService(normalizedSettings);
			const success = await ds.testRoomServerConnection();

			if (success) {
				setTestStatusAlert(<Alert title='Connection successful!' type='success' showIcon closable />);
			} else {
				setTestStatusAlert(<Alert title='Could not connect to room server' type='error' showIcon closable />);
			}
		} catch (err) {
			const errMessage = err instanceof Error ? err.message : 'Connection failed';
			setTestStatusAlert(<Alert title={errMessage} type='error' showIcon closable />);
		}

		setTestingConnection(false);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 10000);
	};

	// Check if server has Discord auth enabled
	const checkAuthAndSignIn = async () => {
		setCheckingAuth(true);
		setTestStatusAlert(null);

		try {
			const normalizedHost = getNormalizedHost();

			// First check if server is reachable and if auth is enabled
			const healthResponse = await fetch(`${normalizedHost}/health`);
			if (!healthResponse.ok) {
				throw new Error('Could not connect to server');
			}

			const health = await healthResponse.json();

			if (health.authConfigured) {
				// Get Discord auth URL and redirect
				const authUrlResponse = await fetch(`${normalizedHost}/auth/discord/url`);
				if (!authUrlResponse.ok) {
					throw new Error('Could not get Discord auth URL');
				}

				const { url } = await authUrlResponse.json();

				// Save current settings before redirect (so callback knows the server host)
				const normalizedSettings = getSettingsWithNormalizedHost();
				props.setConnectionSettings(normalizedSettings);

				// Redirect to Discord OAuth
				window.location.href = url;
			} else {
				// Auth not configured - fall back to legacy connect
				await connectToServerLegacy();
			}
		} catch (err) {
			const errMessage = err instanceof Error ? err.message : 'Connection failed';
			setTestStatusAlert(<Alert title={errMessage} type='error' showIcon closable />);
		}

		setCheckingAuth(false);
	};

	// Legacy connection without Discord auth (for servers without auth configured)
	const connectToServerLegacy = async () => {
		setConnecting(true);
		setTestStatusAlert(null);

		try {
			const normalizedSettings = getSettingsWithNormalizedHost();
			const ds = new DataService(normalizedSettings);
			const result = await ds.connectToRoomServer();

			const copy = Utils.copy(normalizedSettings);
			copy.clientId = result.clientId;
			copy.role = result.role;
			setConnectionSettings(copy);

			// Auto-save when connecting
			props.setConnectionSettings(copy);
			setConnectionSettingsChanged(false);

			const roleText = result.role === 'dm' ? 'Director (DM)' : 'Player';
			const clientIdDisplay = result.clientId ? result.clientId.substring(0, 8) : 'unknown';
			setTestStatusAlert(
				<Alert
					title={`Connected as ${roleText}`}
					description={`Client ID: ${clientIdDisplay}...`}
					type='success'
					showIcon
					closable
				/>
			);
		} catch (err) {
			const errMessage = err instanceof Error ? err.message : 'Connection failed';
			setTestStatusAlert(<Alert title={errMessage} type='error' showIcon closable />);
		}

		setConnecting(false);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 10000);
	};

	const signOut = () => {
		const copy = Utils.copy(connectionSettings);
		copy.authToken = undefined;
		copy.authenticatedUser = undefined;
		copy.clientId = undefined;
		copy.role = undefined;
		setConnectionSettings(copy);
		props.setConnectionSettings(copy);
		setTestStatusAlert(<Alert title='Signed out' type='info' showIcon closable />);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 3000);
	};

	const handleClaimDirector = async () => {
		setClaimingDirector(true);
		setTestStatusAlert(null);

		try {
			const ds = new DataService(connectionSettings);
			const result = await ds.claimDirectorRole();

			if (result.success) {
				// Update local and parent state with new role
				const copy = Utils.copy(connectionSettings);
				copy.role = result.role;
				setConnectionSettings(copy);
				props.setConnectionSettings(copy);
				setDirectorStatus({ canClaim: false, dmIsDiscordUser: true });
				setTestStatusAlert(<Alert title='You are now the Director!' type='success' showIcon closable />);
			}
		} catch (err) {
			const errMessage = err instanceof Error ? err.message : 'Failed to claim director role';
			setTestStatusAlert(<Alert title={errMessage} type='error' showIcon closable />);
		}

		setClaimingDirector(false);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 5000);
	};

	const handleReleaseDirector = async () => {
		setReleasingDirector(true);
		setTestStatusAlert(null);

		try {
			const ds = new DataService(connectionSettings);
			const result = await ds.releaseDirectorRole();

			if (result.success) {
				// Update local and parent state with new role
				const copy = Utils.copy(connectionSettings);
				copy.role = result.role;
				setConnectionSettings(copy);
				props.setConnectionSettings(copy);
				setDirectorStatus({ canClaim: false, dmIsDiscordUser: false });
				setTestStatusAlert(<Alert title='Director role released' type='info' showIcon closable />);
			}
		} catch (err) {
			const errMessage = err instanceof Error ? err.message : 'Failed to release director role';
			setTestStatusAlert(<Alert title={errMessage} type='error' showIcon closable />);
		}

		setReleasingDirector(false);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 5000);
	};

	const saveSettings = () => {
		props.setConnectionSettings(connectionSettings);
		setConnectionSettingsChanged(false);
	};

	const isAuthenticated = !!connectionSettings.authToken && !!connectionSettings.authenticatedUser;
	const isConnected = !!connectionSettings.clientId;

	// Build Discord avatar URL
	const getAvatarUrl = () => {
		const user = connectionSettings.authenticatedUser;
		if (!user?.avatar) return undefined;
		return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
	};

	return (
		<Space orientation='vertical' style={{ width: '100%' }}>
			<Toggle
				label='Connect to Room Server'
				value={connectionSettings.useRoomServer}
				onChange={setUseRoomServer}
			/>
			{connectionSettings.useRoomServer && (
				<>
					<HeaderText>Server Address</HeaderText>
					<Input
						placeholder='https://your-server.com'
						allowClear={true}
						value={connectionSettings.roomServerHost}
						onChange={e => setRoomServerHost(e.target.value)}
						disabled={isAuthenticated}
					/>
					<div className='ds-text' style={{ fontSize: '12px', opacity: 0.7 }}>
						Enter the address of the room server (e.g., https://your-server.com)
					</div>
				</>
			)}

			{/* Show authenticated user info - visible even when room server is disabled */}
			{isAuthenticated && connectionSettings.authenticatedUser && (
				<>
					<HeaderText>Signed In</HeaderText>
					<Flex gap='small' align='center'>
						<Avatar
							src={getAvatarUrl()}
							icon={!getAvatarUrl() ? <UserOutlined /> : undefined}
							size='small'
						/>
						<span className='ds-text'>
							{connectionSettings.authenticatedUser.displayName}
						</span>
						{connectionSettings.role && (
							<Tag color={connectionSettings.role === 'dm' ? 'gold' : 'blue'}>
								{connectionSettings.role === 'dm' ? 'Director' : 'Player'}
							</Tag>
						)}
					</Flex>
				</>
			)}

			{/* Legacy connection info (no auth, but connected) */}
			{connectionSettings.useRoomServer && !isAuthenticated && isConnected && (
				<Flex gap='small' align='center'>
					<Tag icon={<UserOutlined />} color={connectionSettings.role === 'dm' ? 'gold' : 'blue'}>
						{connectionSettings.role === 'dm' ? 'Director' : 'Player'}
					</Tag>
					<span className='ds-text' style={{ fontSize: '12px' }}>
						{connectionSettings.playerName ? `${connectionSettings.playerName} - ` : ''}
						ID: {connectionSettings.clientId?.substring(0, 8)}...
					</span>
				</Flex>
			)}

			<Flex gap='small' justify='flex-end' wrap>
				{connectionSettings.useRoomServer && connectionSettings.roomServerHost && (
					<>
						<Button
							loading={testingConnection}
							icon={<CloudServerOutlined />}
							onClick={testConnection}
						>
							Test
						</Button>
						{!isAuthenticated && (
							<Button
								loading={checkingAuth || connecting}
								icon={<LoginOutlined />}
								onClick={checkAuthAndSignIn}
								type='primary'
							>
								Sign in with Discord
							</Button>
						)}
					</>
				)}
				{/* Claim Director button - visible when authenticated, not DM, and can claim */}
				{isAuthenticated && connectionSettings.role !== 'dm' && directorStatus?.canClaim && (
					<Button
						loading={claimingDirector}
						icon={<CrownOutlined />}
						onClick={handleClaimDirector}
						type='primary'
					>
						Claim Director
					</Button>
				)}
				{/* Release Director button - visible when authenticated and is DM */}
				{isAuthenticated && connectionSettings.role === 'dm' && (
					<Button
						loading={releasingDirector}
						icon={<CrownOutlined />}
						onClick={handleReleaseDirector}
						danger
					>
						Release Director
					</Button>
				)}
				{/* Sign Out button - visible whenever authenticated */}
				{isAuthenticated && (
					<Button
						icon={<LogoutOutlined />}
						onClick={signOut}
					>
						Sign Out
					</Button>
				)}
				<Button
					color='primary'
					variant='solid'
					icon={<SaveFilled />}
					onClick={saveSettings}
					disabled={!connectionSettingsChanged}
				>
					Save
				</Button>
			</Flex>
			{testStatusAlert}
		</Space>
	);
};
