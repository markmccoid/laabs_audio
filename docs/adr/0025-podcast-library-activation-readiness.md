# Podcast Library Activation readiness is Podcast Series Index ready

For a podcast Library, Library Activation commits the Active Library only when the **Podcast Series Index** is ready for that User Session and Library: a completed series-index refresh (including an empty library), or a remembered local index from a prior successful refresh when offline or when a new refresh fails. Episode lists, Recent Episodes, and Touched Episode overlay refresh are post-commit enhancements — not Activation gates. Failure with no local index does not commit; Retry/Cancel follow ADR 0009.

The Library Selection / Activation shell stays shared; the podcast branch’s ready-predicate is series-index readiness only.

## Consequences

- Home may be browsable with Continue from existing Touched Episode rows while Recent Episodes is still loading or unavailable offline.
- Show-detail episode discovery remains on-demand after Activation.
- A blank first-time podcast Library with no network and no remembered index cannot become the Active Library.
