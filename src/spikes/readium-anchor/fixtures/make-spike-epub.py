#!/usr/bin/env python3
"""
Builds the spike's fixture EPUB.

A random book is a poor fixture: half the E3 perturbations have nothing to bite
on (no curly quotes in that sentence, no noteref anywhere in the chapter) and E4
needs a sentence that genuinely repeats. This book is written so every case has
something to test:

- typographic punctuation and em-dashes           -> 3b, 3c
- accented words                                  -> 3f
- an inline noteref marker                        -> 3g  (the D7 case)
- "He nodded." three times with different context -> E4
- the OPF lives in OEBPS/, so hrefs are path-qualified rather than bare -> E2
- ~60 paragraphs of prose, so a search for "the" yields bulk anchors    -> E5

Regenerate with:  python3 make-spike-epub.py [output.epub]
"""

import sys
import zipfile
from pathlib import Path

CONTAINER = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
"""

# Paragraph 3 carries the noteref; paragraphs 5, 12 and 31 repeat "He nodded."
# with different surrounding text, which is what E4 needs.
PARAGRAPHS = [
    "The harbour was quiet that morning, and the light came off the water in long flat sheets.",
    "“Well,” he said — softly, as though the room were listening — “the café is closed.”",
    "She had been naïve about the whole business, and the résumé of it read badly in daylight.",
    "He said it gravely.<a epub:type=\"noteref\" href=\"notes.xhtml#n1\" id=\"r1\">12</a> Nobody in the room disagreed with him.",
    "The clock struck twelve. He nodded. Then the door closed behind them both.",
    "Outside, the gulls worked the length of the quay in short unhurried arcs.",
    "There was a smell of tar and cold iron, and under it something older and saltier.",
    "The ledger had been kept in a hand that leaned hard to the right.",
    "Every entry was dated, and every date was wrong by exactly one day.",
    "He turned the page and found the same three names written out again.",
    "The lamp guttered once and steadied.",
    "She asked him whether the ship had sailed. He nodded. The answer cost him something.",
    "It was the kind of silence that arrives after a decision rather than before one.",
    "They walked back along the seawall without speaking.",
    "The tide had turned while they were inside, and the boats sat lower against the stone.",
    "A man was mending nets at the far end, and he did not look up as they passed.",
    "The rope in his hands moved the way water moves, without seeming to move at all.",
    "By the time they reached the road the light had gone orange and low.",
    "The town began at a bend and ended at a bend, and between them it kept very little.",
    "There was a chandlery, a chapel, and a public house that had once been a bank.",
    "The chapel bell had been cracked for as long as anyone had been alive to say so.",
    "It still rang, after a fashion, and nobody had ever thought to replace it.",
    "He stopped at the door of the chandlery and read the notice pinned there twice.",
    "The paper was damp and the ink had run into the grain of the wood behind it.",
    "She waited on the step with her hands pushed into her sleeves.",
    "The wind came up the street from the harbour and went out again just as quickly.",
    "Inside, the shop smelled of hemp and linseed oil and the dust of dry goods.",
    "The owner knew them both by name and pretended, out of courtesy, that he did not.",
    "They bought a lamp wick, a tin of oil, and a length of line they did not need.",
    "The transaction took longer than it should have, which was the point of it.",
    "He asked whether the letter had come. He nodded. That was the end of the conversation.",
    "They carried the parcels out into a street that had emptied while they stood there.",
    "The last of the light was on the upper windows and nowhere else.",
    "A dog crossed ahead of them, unhurried, and vanished between two walls.",
    "The path up to the house was steep enough to make talking difficult.",
    "That suited them both, and they climbed it in the ordinary companionable quiet.",
    "At the top she stopped and looked back down at the water without comment.",
    "The boats had all come in. The harbour held them the way a hand holds coins.",
    "He put the parcels down on the wall and waited until she was ready to go on.",
    "The house was cold and smelled of yesterday's fire.",
    "He knelt at the grate and built a new one out of what the old one had left.",
    "She lit the lamp with the new wick and set it in the window where it always went.",
    "The light did not carry far, but it carried far enough to be seen from the road.",
    "They ate the end of the bread and did not speak about the letter.",
    "Later he took the ledger out again and read the wrong dates by lamplight.",
    "The pattern was there, and it had been there for months, and he had not seen it.",
    "Every wrong date fell on a day the harbour master had been away from the town.",
    "He closed the book and sat with his hands flat on the cover for a long while.",
    "The fire went down to a red seam and then to nothing worth the name.",
    "She had fallen asleep in the chair with her boots still on.",
    "He did not wake her, because waking her would have required an explanation.",
    "Instead he put his coat back on and went down the hill in the dark.",
    "The road was pale enough to follow and the sea made the only sound.",
    "At the harbour the water was black and completely still.",
    "The harbour master's office had a light in it, which at that hour meant something.",
    "He stood in the road a while and watched the window without approaching it.",
    "Then he went in, because standing in a road all night settles nothing.",
    "The conversation that followed was brief and entirely civil.",
    "He came out again before the light changed and walked home along the seawall.",
    "By morning the boats were going out as though nothing at all had been decided.",
]

NOTES = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Notes</title></head>
<body>
  <section epub:type="footnotes">
    <aside epub:type="footnote" id="n1"><p>12. A note, so the marker above has somewhere to point.</p></aside>
  </section>
</body>
</html>
"""

CHAPTER_TWO = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Chapter Two</title></head>
<body>
  <h1>Chapter Two</h1>
  <p>A second resource, so the table of contents has more than one href to compare.</p>
  <p>He nodded. The phrase repeats here too, in a different resource entirely.</p>
</body>
</html>
"""


def chapter_one() -> str:
    body = "\n  ".join(f"<p>{paragraph}</p>" for paragraph in PARAGRAPHS)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Chapter One</title></head>
<body>
  <h1>Chapter One</h1>
  {body}
</body>
</html>
"""


OPF = """<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:laabs-readium-anchor-spike</dc:identifier>
    <dc:title>Readium Anchor Spike Fixture</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>LAABS Audio</dc:creator>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch01" href="ch01.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch02" href="ch02.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch01"/>
    <itemref idref="ch02"/>
    <itemref idref="notes"/>
  </spine>
</package>
"""

NAV = """<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <ol>
      <li><a href="ch01.xhtml">Chapter One</a></li>
      <li><a href="ch02.xhtml">Chapter Two</a></li>
      <li><a href="notes.xhtml">Notes</a></li>
    </ol>
  </nav>
</body>
</html>
"""


def build(destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as book:
        # The mimetype entry must be first and stored uncompressed.
        book.writestr(
            zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED
        )
        book.writestr("META-INF/container.xml", CONTAINER)
        book.writestr("OEBPS/content.opf", OPF)
        book.writestr("OEBPS/nav.xhtml", NAV)
        book.writestr("OEBPS/ch01.xhtml", chapter_one())
        book.writestr("OEBPS/ch02.xhtml", CHAPTER_TWO)
        book.writestr("OEBPS/notes.xhtml", NOTES)


if __name__ == "__main__":
    output = Path(sys.argv[1] if len(sys.argv) > 1 else "readium-anchor-spike.epub")
    build(output)
    print(f"wrote {output} ({output.stat().st_size} bytes)")
