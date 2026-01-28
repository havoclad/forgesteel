import { DataLoader, LoadedData } from '@/components/panels/data-loader/data-loader';
import { ErrorBoundary } from '@/components/controls/error-boundary/error-boundary';
import { HashRouter } from 'react-router';
import { Main } from '@/components/main/main.tsx';
import { ServiceWorkerLogic } from './logic/service-worker-logic';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeTheme } from '@/utils/initialize-theme';

import './index.scss';

initializeTheme();

// Handle OAuth callback redirect for HashRouter
// Discord redirects to /forgesteel/auth/callback?code=... but HashRouter needs /#/auth/callback?code=...
// This detects the OAuth callback and redirects to the hash-based route
if (window.location.pathname.endsWith('/auth/callback') && window.location.search.includes('code=')) {
	const hashUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/auth/callback${window.location.search}`;
	window.location.replace(hashUrl);
}

const unregisterServiceWorker = async () => {
	if ('serviceWorker' in navigator) {
		const registrations = await navigator.serviceWorker.getRegistrations();
		for (const registration of registrations) {
			await registration.unregister();
		}
	}
};

const onDataLoaded = (data: LoadedData) => {
	if ('serviceWorker' in navigator) {
		if (ServiceWorkerLogic.shouldDisableServiceWorker(data.connectionSettings)) {
			unregisterServiceWorker();
		} else {
			window.addEventListener('load', () => {
				navigator.serviceWorker.register('/forgesteel/sw.js')
					.catch(registrationError => {
						console.error('SW registration failed: ', registrationError);
					});
			});
		}
	}
	root.render(
		<StrictMode>
			<HashRouter>
				<Main
					heroes={data.heroes}
					homebrewSourcebooks={data.homebrew}
					hiddenSourcebookIDs={data.hiddenSourcebookIDs}
					session={data.session}
					options={data.options}
					connectionSettings={data.connectionSettings}
					dataService={data.service}
				/>
			</HashRouter>
		</StrictMode>
	);
};

const root = createRoot(document.getElementById('root')!);
root.render(
	<ErrorBoundary>
		<DataLoader onComplete={onDataLoaded} />
	</ErrorBoundary>
);
