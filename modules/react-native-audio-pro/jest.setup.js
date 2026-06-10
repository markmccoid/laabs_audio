jest.useFakeTimers();

jest.mock('react-native', () => ({
	Platform: {
		OS: 'ios',
	},
	NativeModules: {
		AudioPro: {
			play: jest.fn(),
			updateConfiguration: jest.fn(),
			pause: jest.fn(),
			resume: jest.fn(),
			stop: jest.fn(),
			ambientPlay: jest.fn(),
			ambientStop: jest.fn(),
			ambientPause: jest.fn(),
			ambientResume: jest.fn(),
			seekTo: jest.fn(),
			seekForward: jest.fn(),
			seekBack: jest.fn(),
			setPlaybackSpeed: jest.fn(),
			setVolume: jest.fn(),
			clear: jest.fn(),
		},
	},
	NativeEventEmitter: jest.fn().mockImplementation(() => ({
		addListener: jest.fn(() => ({ remove: jest.fn() })),
		removeListener: jest.fn(),
	})),
}));

const mockState = {
	playerState: 'PLAYING',
	position: 0,
	duration: 0,
	trackPlaying: { url: 'https://example.com/audio.mp3' },
	volume: 1.0,
	playbackSpeed: 1.0,
	configureOptions: {
		remoteCommandMode: 'next-prev',
		progressIntervalMs: 1000,
		showNextPrevControls: true,
		showSkipControls: false,
		disableLockScreenSeek: false,
		skipIntervalMs: 30000,
		skipForwardIntervalMs: 30000,
		skipBackwardIntervalMs: 30000,
	},
	error: null,
	debug: false,
	debugIncludesProgress: false,
};

const mockActions = {
	setTrackPlaying: jest.fn(),
	setError: jest.fn(),
	setPlaybackSpeed: jest.fn(),
	setVolume: jest.fn(),
	setConfigureOptions: jest.fn(),
	setDebug: jest.fn(),
	setDebugIncludesProgress: jest.fn(),
	updateFromEvent: jest.fn(),
};

beforeEach(() => {
	mockState.configureOptions = {
		remoteCommandMode: 'next-prev',
		progressIntervalMs: 1000,
		showNextPrevControls: true,
		showSkipControls: false,
		disableLockScreenSeek: false,
		skipIntervalMs: 30000,
		skipForwardIntervalMs: 30000,
		skipBackwardIntervalMs: 30000,
	};
	mockActions.setConfigureOptions.mockImplementation((options) => {
		mockState.configureOptions = options;
	});
});

function createInternalStoreMock(modulePath) {
	const mockOptions = modulePath.includes('.conductor') ? { virtual: true } : undefined;
	jest.doMock(
		modulePath,
		() => {
			const internalStore = jest.fn((selector) => selector(mockState));
			internalStore.getState = () => ({
				...mockState,
				...mockActions,
			});
			internalStore.setState = jest.fn();
			internalStore.subscribe = jest.fn();
			return { internalStore };
		},
		mockOptions,
	);
}

function createEmitterMock(modulePath) {
	const mockOptions = modulePath.includes('.conductor') ? { virtual: true } : undefined;
	jest.doMock(
		modulePath,
		() => ({
			emitter: {
				emit: jest.fn(),
				addListener: jest.fn(() => ({ remove: jest.fn() })),
			},
			ambientEmitter: {
				emit: jest.fn(),
				addListener: jest.fn(() => ({ remove: jest.fn() })),
			},
		}),
		mockOptions,
	);
}

createInternalStoreMock('./src/internalStore');
createInternalStoreMock('./.conductor/hong-kong/src/internalStore');

createEmitterMock('./src/emitter');
createEmitterMock('./.conductor/hong-kong/src/emitter');
