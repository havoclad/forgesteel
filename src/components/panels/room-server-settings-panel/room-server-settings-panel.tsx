import { Alert, Button, Flex, Input, Space, Tag } from 'antd';
import { CloudServerOutlined, SaveFilled, UserOutlined } from '@ant-design/icons';
import { JSX, useState } from 'react';
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
	const [ testStatusAlert, setTestStatusAlert ] = useState<JSX.Element | null>(null);

	const setUseRoomServer = (value: boolean) => {
		const copy = Utils.copy(connectionSettings);
		copy.useRoomServer = value;
		if (!value) {
			// Clear connection state when disabling
			copy.clientId = undefined;
			copy.role = undefined;
		}
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
				setTestStatusAlert(<Alert message='Connection successful!' type='success' showIcon closable />);
			} else {
				setTestStatusAlert(<Alert message='Could not connect to room server' type='error' showIcon closable />);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Connection failed';
			setTestStatusAlert(<Alert message={message} type='error' showIcon closable />);
		}

		setTestingConnection(false);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 10000);
	};

	const connectToServer = async () => {
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
					message={`Connected as ${roleText}`}
					description={`Client ID: ${clientIdDisplay}...`}
					type='success'
					showIcon
					closable
				/>
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Connection failed';
			setTestStatusAlert(<Alert message={message} type='error' showIcon closable />);
		}

		setConnecting(false);
		setTimeout(() => {
			setTestStatusAlert(null);
		}, 10000);
	};

	const saveSettings = () => {
		props.setConnectionSettings(connectionSettings);
		setConnectionSettingsChanged(false);
	};

	const isConnected = !!connectionSettings.clientId && !!connectionSettings.role;

	return (
		<Space direction='vertical' style={{ width: '100%' }}>
			<Toggle
				label='Connect to Room Server'
				value={connectionSettings.useRoomServer}
				onChange={setUseRoomServer}
			/>
			{
				connectionSettings.useRoomServer ?
					<>
						<HeaderText>Server Address</HeaderText>
						<Input
							placeholder='http://192.168.1.100:3001'
							allowClear={true}
							value={connectionSettings.roomServerHost}
							onChange={e => setRoomServerHost(e.target.value)}
						/>
						<div className='ds-text' style={{ fontSize: '12px', opacity: 0.7 }}>
							Enter the address of the room server (e.g., http://192.168.1.100:3001)
						</div>

						{isConnected && (
							<Flex gap='small' align='center'>
								<Tag icon={<UserOutlined />} color={connectionSettings.role === 'dm' ? 'gold' : 'blue'}>
									{connectionSettings.role === 'dm' ? 'Director' : 'Player'}
								</Tag>
								<span className='ds-text' style={{ fontSize: '12px' }}>
									ID: {connectionSettings.clientId?.substring(0, 8)}...
								</span>
							</Flex>
						)}
					</>
					: null
			}
			<Flex gap='small' justify='flex-end' wrap>
				{
					connectionSettings.useRoomServer && connectionSettings.roomServerHost ?
						<>
							<Button
								loading={testingConnection}
								icon={<CloudServerOutlined />}
								onClick={testConnection}
							>
								Test
							</Button>
							<Button
								loading={connecting}
								icon={<CloudServerOutlined />}
								onClick={connectToServer}
								type={isConnected ? 'default' : 'primary'}
							>
								{isConnected ? 'Reconnect' : 'Connect'}
							</Button>
						</>
						: null
				}
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
