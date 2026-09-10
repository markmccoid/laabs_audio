# Alignment Maps are paired by enumeration, not by constructing a filename

An Alignment Map is published as `laabs.<epub-stem>.alignment.json` — the EPUB's filename without its
extension — amending LAABS Audio Align's D35, which named it after the first eight hex characters of
the EPUB's `sha256`. LAABS never *constructs* that filename to look a map up. It enumerates
`laabs.*.alignment.json` out of the item's `libraryFiles`, matches the affix-stripped stem against the
stems `collectEbookFiles` reports — NFC-normalized, casefolded, non-alphanumerics dropped — and then
verifies the pairing against the downloaded map's own `derivedFrom.epub.ino` and `sha256`.

The filename therefore only has to be *discriminating*, never reproducible. That is the whole point of
the split: the producer writes over SMB from macOS, which normalizes Unicode to NFD, onto a Linux host
that stores NFC; SMB is case-insensitive where Linux is not; and a title carrying a colon or a question
mark cannot be a filename on SMB at all, so the producer must sanitize. A reader that built the name
would have to reimplement that sanitization exactly — the cross-implementation agreement D4 was taken
to avoid. A reader that matches tolerantly does not care.

## Considered Options

- **Keep `laabs.<epub8>.alignment.json` and pair by reading `derivedFrom.epub` from the body.**
  Rejected: correct, but it makes disambiguation cost a 1.4 MB download per candidate, and it leaves an
  orphaned map on the server every time an EPUB is re-converted, because the new hash writes a new file
  rather than overwriting the old one.
- **Construct the filename from the EPUB's name and look it up exactly.** Rejected for the
  normalization, case and sanitization reasons above. It fails silently — a missing map is
  indistinguishable from a book that was never aligned.
- **Name the map after the EPUB's `ino`.** Rejected for D35's original reason: an ino is a server inode
  that changes when the file is re-imported, so the map would orphan itself on an operation that
  changed nothing about the book.

## Consequences

- LAABS Audio Align must amend D35, define the sanitization rule for filesystem-illegal characters, and
  re-emit the one map already published (`laabs.0adf089c.alignment.json` on
  `87c842fa-8530-4082-b45e-9034c9192f04`), deleting the old file.
- When exactly one map and one alignable ebook exist — the overwhelmingly common case, and true of both
  books currently under test — the stem match is a formality and the body check is what actually
  establishes the pairing.
- A re-converted EPUB keeping its filename now silently inherits the old map's filename. This changes
  nothing about behaviour: `derivedFrom.epub.sha256` still detects it, and the contract's staleness
  table already treats that mismatch as a warning rather than a failure. What is lost is the visual cue
  a human browsing the item folder used to get from a stale hash in the name.
