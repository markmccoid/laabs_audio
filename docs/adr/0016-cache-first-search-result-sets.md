# Cache-First Search Result Sets

LAABS Audio derives Search Result Sets from cached Active Library item summaries first, rather than making Audiobookshelf Server search the default Search path. Search Result Sets are ordered Audiobook Identities produced from indexed Active Library metadata plus User Session overlays such as Favorite and Finished state.

Audiobookshelf Server search remains a future adapter behind the Search module. It may be used later for cases where server ranking, broader matching, or very large Library performance justify the network dependency.

## Consequences

- Search remains usable from restored Active Library data without waiting for a server round trip.
- Search behavior stays coherent with Library Activation, which makes an Active Library browsable from cached item summaries.
- The Search module owns text matching, genre/tag facet matching, Favorite/Finished overlays, and sort projection for the cache-first path.
- Search results use stable Audiobook Identities before resolving display metadata, so list rendering is not tied to freshly merged book objects.
- Audiobookshelf Server `/search` and `/items?filter=...` endpoints are not the default Search path because they introduce latency, offline limitations, and incomplete coverage for LAABS Audio's multi-filter Search expression.
- A future Server Search adapter must satisfy the same Search module interface and return Search Result Sets that can be displayed through the same row path.
