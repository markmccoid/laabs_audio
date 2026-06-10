/* eslint-disable @typescript-eslint/no-explicit-any */
import { emitter } from '../emitter';
import { internalStore } from '../internalStore';
import {
	isValidUrl,
	validateTrack,
	guardTrackPlaying,
	logDebug,
	validateFilePath,
} from '../utils';
import { normalizeVolume } from '../volume';
import { AudioProEventType } from '../values';

import type { AudioProTrack } from '../types';

// Define a type for our mock store state
interface MockStoreState {
	playerState: string;
	position: number;
	duration: number;
	trackPlaying: { url: string } | null | Record<string, never>;
	volume: number;
	playbackSpeed: number;
	configureOptions: {
		progressIntervalMs: number;
	};
	error: null;
	debug: boolean;
	debugIncludesProgress: boolean;
}

// Define a mock state that can be modified in tests
const mockState: MockStoreState = {
	playerState: 'PLAYING',
	position: 0,
	duration: 0,
	trackPlaying: { url: 'https://example.com/audio.mp3' },
	volume: 1.0,
	playbackSpeed: 1.0,
	configureOptions: {
		progressIntervalMs: 1000,
	},
	error: null,
	debug: false,
	debugIncludesProgress: false,
};

// Mock react-native modules
jest.mock('react-native', () => ({
	Platform: { OS: 'android' },
	Image: { resolveAssetSource: jest.fn() },
}));

// Mock emitter
jest.mock('../emitter', () => ({
	emitter: { emit: jest.fn() },
}));

describe('isValidUrl', () => {
	beforeEach(() => {
		// Reset mockState for each test
		mockState.debug = false;
		// Update the useInternalStore.getState mock
		jest.spyOn(internalStore, 'getState').mockImplementation(() => mockState as any);
		jest.spyOn(console, 'warn').mockImplementation(() => {});
	});
	it('returns false for empty or whitespace strings', () => {
		expect(isValidUrl('')).toBe(false);
		expect(isValidUrl('   ')).toBe(false);
	});
	it('accepts common URL schemes', () => {
		['http://', 'https://', 'file://', 'data:', 'blob:'].forEach((scheme) => {
			expect(isValidUrl(`${scheme}resource`)).toBe(true);
		});
	});
});

describe('validateFilePath', () => {
	beforeEach(() => {
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('does not error for supported schemes', () => {
		validateFilePath('http://example.com/audio.mp3');
		validateFilePath('https://example.com/audio.mp3');
		validateFilePath('file:///path/to/audio.mp3');
		expect(console.error).not.toHaveBeenCalled();
	});

	it('logs error for unsupported schemes', () => {
		const invalidPath = 'ftp://example.com/audio.mp3';
		validateFilePath(invalidPath);
		expect(console.error).toHaveBeenCalledWith(
			`[react-native-audio-pro] Invalid file path detected: ftp://example.com/audio.mp3. Only http://, https://, and file:// schemes are recognized.`,
		);
	});
});

describe('normalizeVolume', () => {
	it('returns 0 for volume 0 or near zero', () => {
		expect(normalizeVolume(0)).toBe(0);
		expect(normalizeVolume(0.0005)).toBe(0);
	});
	it('returns 1 for values near 1', () => {
		expect(normalizeVolume(0.998)).toBe(1);
		expect(normalizeVolume(1)).toBe(1);
	});
	it('clamps and formats within range', () => {
		expect(normalizeVolume(1.5)).toBe(1);
		expect(normalizeVolume(-0.5)).toBe(0);
		expect(normalizeVolume(0.55555)).toBe(0.56);
	});
});

describe('validateTrack', () => {
	const baseTrack: AudioProTrack = {
		id: '1',
		url: 'http://a.mp3',
		title: 'Title',
		artwork: 'http://b.jpg',
	};

	beforeEach(() => {
		// Reset mockState for each test
		mockState.debug = false;
		// Update the useInternalStore.getState mock
		jest.spyOn(internalStore, 'getState').mockImplementation(() => mockState as any);
	});

	it('returns true for a valid track', () => {
		expect(validateTrack(baseTrack as any)).toBe(true);
	});
	it('fails without id', () => {
		expect(validateTrack({ ...baseTrack, id: '' } as any)).toBe(false);
	});
	it('fails without url', () => {
		expect(validateTrack({ ...baseTrack, url: '' } as any)).toBe(false);
	});
	it('fails with invalid artwork', () => {
		expect(validateTrack({ ...baseTrack, artwork: '' } as any)).toBe(false);
	});
	it('fails if album or artist are wrong type', () => {
		expect(validateTrack({ ...baseTrack, album: 123 } as any)).toBe(false);
		expect(validateTrack({ ...baseTrack, artist: 123 } as any)).toBe(false);
	});
});

describe('guardTrackPlaying', () => {
	beforeEach(() => {
		// Reset mockState for each test
		mockState.trackPlaying = null;
		// Update the useInternalStore.getState mock
		jest.spyOn(internalStore, 'getState').mockImplementation(() => mockState as any);
		(emitter.emit as jest.Mock).mockClear();
		// Mock console.error to prevent actual error messages in tests
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});
	it('returns false and emits error when no track', () => {
		const result = guardTrackPlaying('play');
		expect(result).toBe(false);
		expect(emitter.emit).toHaveBeenCalledWith(
			'AudioProEvent',
			expect.objectContaining({
				type: AudioProEventType.PLAYBACK_ERROR,
			}),
		);
	});
	it('returns true when trackPlaying is truthy', () => {
		mockState.trackPlaying = {};
		const result = guardTrackPlaying('play');
		expect(result).toBe(true);
		expect(emitter.emit).not.toHaveBeenCalled();
	});
});

describe('logDebug', () => {
	beforeEach(() => {
		// Reset mockState for each test
		mockState.debug = false;
		// Update the useInternalStore.getState mock
		jest.spyOn(internalStore, 'getState').mockImplementation(() => mockState as any);
		jest.spyOn(console, 'log').mockImplementation(() => {});
	});
	it('logs when debug true', () => {
		mockState.debug = true;
		logDebug('hello', 1);
		expect(console.log).toHaveBeenCalledWith('[react-native-audio-pro]', 'hello', 1);
	});
	it('does not log when debug false', () => {
		mockState.debug = false;
		logDebug('hello', 1);
		expect(console.log).not.toHaveBeenCalled();
	});
});
