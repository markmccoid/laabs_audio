# iOS-First Clip Transcription Uses Apple Speech

Clip Transcription will start as an iOS-first native Expo module that uses Apple Speech to create text from a saved Clip Bookmark's Clip Range. The first implementation may use server-assisted Apple Speech when on-device recognition is unavailable, requests speech permission only when the user starts transcription, returns structured final results without persistence, and treats Android as out of scope until the app has an Android target. This is intentionally not cross-platform parity: iOS has a stable file-based speech request, while Android file-input recognition is recognizer-dependent and would need separate device validation or a different provider.

