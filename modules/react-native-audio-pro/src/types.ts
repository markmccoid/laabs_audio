import {
	AudioProTriggerSource,
	AudioProAmbientEventType,
	AudioProContentType,
	AudioProEventType,
	AudioProState,
} from './values';

// ==============================
// TRACK
// ==============================

export type AudioProArtwork = string;

export type AudioProTrack = {
	id: string;
	url: string;
	title: string;
	artwork: AudioProArtwork;
	album?: string;
	artist?: string;
	[key: string]: unknown; // custom properties
};

// ==============================
// CONFIGURE OPTIONS
// ==============================

export type AudioProRemoteCommandMode = 'next-prev' | 'skip-intervals' | 'none';

export type AudioProConfigureOptions = {
	contentType?: AudioProContentType;
	debug?: boolean;
	debugIncludesProgress?: boolean;
	progressIntervalMs?: number;
	remoteCommandMode?: AudioProRemoteCommandMode;
	showNextPrevControls?: boolean;
	showSkipControls?: boolean;
	disableLockScreenSeek?: boolean;
	skipIntervalMs?: number;
	skipForwardIntervalMs?: number;
	skipBackwardIntervalMs?: number;
	/**
	 * @deprecated use skipIntervalMs instead
	 */
	skipInterval?: number;
};

// ==============================
// PLAY OPTIONS
// ==============================

export type AudioProHeaders = {
	audio?: Record<string, string>;
	artwork?: Record<string, string>;
};

export type AudioProPlayOptions = {
	autoPlay?: boolean;
	playbackRequestCommandId?: string;
	playbackTargetId?: string;
	headers?: AudioProHeaders;
	startTimeMs?: number;
	listeningContext?: ListeningContext;
	positionIntent?: 'resume' | 'relocate' | 'preview';
	positionCommandId?: string;
	loadId?: string;
};

export type ListeningPositionScope = {
	ownerId: string;
	libraryItemId: string;
	episodeId: string | null;
};

export type ListeningContext = ListeningPositionScope & {
	trackStartOffsetMs: number;
	durationMs: number;
	captureEnabled: boolean;
};

export type ListeningPositionRecord = ListeningPositionScope & {
	schemaVersion: number;
	playbackGeneration: number;
	positionRevision: number;
	sequence: number;
	positionMs: number;
	trackPositionMs: number;
	trackStartOffsetMs: number;
	trackIdentity: string;
	durationMs: number;
	isFinished: boolean;
	reason: string;
	capturedAt: number;
	committedAt: number;
	projectedThroughSequence: number;
	syncedThroughSequence: number;
};

export type ListeningPositionCommand = ListeningPositionScope & {
	positionMs: number;
	durationMs: number;
	isFinished: boolean;
	reason: string;
	commandId?: string;
};

export type PlaybackSnapshot = {
	state: AudioProState;
	position: number;
	duration: number;
	trackId: string | null;
	loadId: string | null;
	initialSeekPending: boolean;
	playbackGeneration: number;
	positionRevision: number;
	positionSequence: number;
	ownerId: string | null;
	libraryItemId: string | null;
	episodeId: string | null;
	reason?: string;
	/** Native monotonic clock; safe across suspended JavaScript delivery. */
	monotonicTimeMs?: number;
	shouldBePlaying?: boolean;
	requestedPlaybackState?: 'playing' | 'paused';
	playbackRequestRevision?: number;
	playbackRequestCommandId?: string | null;
	playbackTargetId?: string | null;
};

export type AudioProEventOrder = {
	loadId?: string | null;
	initialSeekPending?: boolean;
	playbackGeneration?: number;
	positionRevision?: number;
	positionSequence?: number;
	ownerId?: string | null;
	libraryItemId?: string | null;
	episodeId?: string | null;
	reason?: string;
	monotonicTimeMs?: number;
	shouldBePlaying?: boolean;
	requestedPlaybackState?: 'playing' | 'paused';
	playbackRequestRevision?: number;
	playbackRequestCommandId?: string | null;
	playbackTargetId?: string | null;
};

// ==============================
// EVENTS
// ==============================

export type AudioProEventCallback = (event: AudioProEvent) => void;

export interface AudioProEvent {
	type: AudioProEventType;
	track: AudioProTrack | null; // Required for all events except REMOTE_NEXT and REMOTE_PREV
	payload?: AudioProEventOrder & {
		state?: AudioProState;
		position?: number;
		duration?: number;
		error?: string;
		errorCode?: number;
		speed?: number;
	};
}

export interface AudioProStateChangedPayload {
	state: AudioProState;
	position: number;
	duration: number;
}

export interface AudioProTrackEndedPayload {
	position: number;
	duration: number;
}

export interface AudioProPlaybackErrorPayload {
	error: string;
	errorCode?: number;
}

export interface AudioProProgressPayload {
	position: number;
	duration: number;
}

export interface AudioProSeekCompletePayload {
	position: number;
	duration: number;
	/** Indicates who initiated the seek: user or system */
	triggeredBy: AudioProTriggerSource;
}

export interface AudioProPlaybackSpeedChangedPayload {
	speed: number;
}

// ==============================
// AMBIENT AUDIO
// ==============================

export interface AmbientAudioPlayOptions {
	url: string;
	loop?: boolean;
}

export type AudioProAmbientEventCallback = (event: AudioProAmbientEvent) => void;

export interface AudioProAmbientEvent {
	type: AudioProAmbientEventType;
	payload?: {
		error?: string;
		/** AMBIENT_PROGRESS: current position within the ambient track, in ms */
		position?: number;
		/** AMBIENT_PROGRESS: length of the ambient track in ms, 0 while unknown */
		duration?: number;
	};
}

export interface AudioProAmbientProgressPayload {
	position: number;
	duration: number;
}

export interface AudioProAmbientErrorPayload {
	error: string;
}
