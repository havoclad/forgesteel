import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Spin } from 'antd';
import { AuthenticatedUser, ConnectionSettings } from '@/models/connection-settings';

interface Props {
	connectionSettings: ConnectionSettings;
	setConnectionSettings: (settings: ConnectionSettings) => Promise<void> | void;
}

export const AuthCallbackPage = (props: Props) => {
	const [ searchParams ] = useSearchParams();
	const navigate = useNavigate();
	const [ error, setError ] = useState<string | null>(null);
	// Prevent duplicate code exchange (React Strict Mode runs effects twice)
	const exchangeStartedRef = useRef(false);

	useEffect(() => {
		const code = searchParams.get('code');
		const errorParam = searchParams.get('error');

		if (errorParam) {
			setError(`Discord authorization failed: ${errorParam}`);
			return;
		}

		if (!code) {
			setError('No authorization code received from Discord');
			return;
		}

		// Prevent duplicate exchange attempts (codes are single-use)
		if (exchangeStartedRef.current) {
			return;
		}
		exchangeStartedRef.current = true;

		// Exchange code for session token
		const exchangeCode = async () => {
			try {
				const serverHost = props.connectionSettings.roomServerHost;
				if (!serverHost) {
					setError('No room server configured');
					return;
				}

				const response = await fetch(`${serverHost}/auth/discord`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ code })
				});

				if (!response.ok) {
					const data = await response.json().catch(() => ({}));
					throw new Error(data.error || 'Authentication failed');
				}

				const { token, user } = await response.json() as {
					token: string;
					user: AuthenticatedUser;
				};

				// Get role from server using the new auth token
				let role: 'dm' | 'player' = 'player';
				try {
					const connectResponse = await fetch(`${serverHost}/connect`, {
						headers: { Authorization: `Bearer ${token}` }
					});
					if (connectResponse.ok) {
						const connectData = await connectResponse.json();
						role = connectData.role;
					}
				} catch {
					// Role will default to player
				}

				// Update connection settings with auth token, user, and role
				const newSettings: ConnectionSettings = {
					...props.connectionSettings,
					authToken: token,
					authenticatedUser: user,
					clientId: user.id,
					playerName: user.displayName,
					role
				};

				// Wait for settings to persist before navigating
				await props.setConnectionSettings(newSettings);

				// Redirect to home page
				navigate('/', { replace: true });
			} catch (err) {
				console.error('Auth callback error:', err);
				setError(err instanceof Error ? err.message : 'Authentication failed');
			}
		};

		exchangeCode();
	}, [ searchParams, props.connectionSettings.roomServerHost, navigate, props ]);

	if (error) {
		return (
			<div style={{ padding: '40px', maxWidth: '500px', margin: '0 auto' }}>
				<Alert
					type='error'
					showIcon
					title='Authentication Failed'
					description={error}
				/>
				<div style={{ marginTop: '20px', textAlign: 'center' }}>
					<a href='/'>Return to Home</a>
				</div>
			</div>
		);
	}

	return (
		<div style={{
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'center',
			justifyContent: 'center',
			height: '100vh',
			gap: '20px'
		}}
		>
			<Spin size='large' />
			<div>Completing Discord sign-in...</div>
		</div>
	);
};
