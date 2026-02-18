#!/usr/bin/env python3
import os
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

OUTPUT_PATH = "output/pdf/laabs_audio_app_summary.pdf"
PAGE_W, PAGE_H = letter
MARGIN = 40
CONTENT_W = PAGE_W - (MARGIN * 2)

TITLE = "LAABS Audio - One-Page App Summary"

WHAT_IT_IS = [
    "LAABS Audio is an Expo Router React Native app that connects to Audiobookshelf for mobile audiobook listening.",
    "The codebase implements login, library browsing/search, streaming playback, and offline download flows.",
]

WHO_ITS_FOR = [
    "Primary persona: people who run or access an Audiobookshelf server and want a mobile listening client.",
    "Product/market positioning statement: Not found in repo.",
]

WHAT_IT_DOES = [
    "Sign in with server URL, username, and password; stores credentials/tokens and refreshes sessions automatically.",
    "Pick an active library and switch libraries from settings.",
    "Browse/search library books with filters (title/author/description, genres, tags) and cached query data.",
    "Open book detail pages with metadata, cover art, and transport controls.",
    "Stream audiobooks from Audiobookshelf sessions with play/pause, skip, seek, and chapter navigation.",
    "Download audiobooks for offline playback with progress, cancel, and delete controls.",
    "Sync playback/bookmark changes when online and preserve local state for offline use.",
]

HOW_IT_WORKS = [
    "UI: Expo Router screens/tabs in src/app call hooks and feature components (for example LibraryContainer, BookContainer).",
    "State/cache: Zustand stores (auth/books/playback/settings) persist via MMKV; React Query cache persists via mmkvQueryPersister.",
    "Auth/data access: login/refresh in src/auth/*; API modules in src/api/* call absClient -> authFetch -> Audiobookshelf endpoints.",
    "Playback flow: book controls -> playerService -> audio-engine -> react-native-audio-pro; progress sync uses sessionsApi and meApi.",
    "Offline flow: download actions in store-books plus file helpers write local files; pending bookmark operations sync on reconnect.",
]

HOW_TO_RUN = [
    "Install dependencies: npm install",
    "Start the app: npx expo start",
    "Launch on a simulator/device from Expo CLI (iOS/Android), then open the app.",
    "Sign in on the login screen with your Audiobookshelf server URL, username, and password.",
    "Local backend setup/example server credentials: Not found in repo.",
]


def wrap_text(text: str, font_name: str, font_size: int, max_width: float):
    words = text.split()
    if not words:
        return [""]

    lines = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def draw_section_heading(c: canvas.Canvas, y: float, heading: str):
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN, y, heading)
    return y - 14


def draw_paragraph(c: canvas.Canvas, y: float, text: str, font_size: int = 9, leading: int = 11):
    c.setFont("Helvetica", font_size)
    lines = wrap_text(text, "Helvetica", font_size, CONTENT_W)
    for line in lines:
        c.drawString(MARGIN, y, line)
        y -= leading
    return y


def draw_bullets(c: canvas.Canvas, y: float, items, font_size: int = 9, leading: int = 11):
    bullet_indent = 10
    text_indent = 18
    text_width = CONTENT_W - text_indent

    c.setFont("Helvetica", font_size)
    for item in items:
        wrapped = wrap_text(item, "Helvetica", font_size, text_width)
        c.drawString(MARGIN + bullet_indent, y, "-")
        c.drawString(MARGIN + text_indent, y, wrapped[0])
        y -= leading
        for line in wrapped[1:]:
            c.drawString(MARGIN + text_indent, y, line)
            y -= leading
        y -= 2
    return y


def ensure_space(y: float, min_y: float = 42):
    if y < min_y:
        raise RuntimeError("Content overflowed single page; tighten layout.")


def generate_pdf(path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    c = canvas.Canvas(path, pagesize=letter)

    y = PAGE_H - MARGIN
    c.setTitle("LAABS Audio App Summary")

    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, y, TITLE)
    y -= 16

    c.setFont("Helvetica", 8)
    subtitle = "Evidence source: repository files under src/, docs/, and package.json"
    c.drawString(MARGIN, y, subtitle)
    y -= 16

    y = draw_section_heading(c, y, "What It Is")
    for sentence in WHAT_IT_IS:
        y = draw_paragraph(c, y, sentence)
        y -= 2

    y = draw_section_heading(c, y, "Who It Is For")
    y = draw_bullets(c, y, WHO_ITS_FOR)

    y = draw_section_heading(c, y, "What It Does")
    y = draw_bullets(c, y, WHAT_IT_DOES)

    y = draw_section_heading(c, y, "How It Works (Architecture)")
    y = draw_bullets(c, y, HOW_IT_WORKS)

    y = draw_section_heading(c, y, "How To Run")
    y = draw_bullets(c, y, HOW_TO_RUN)

    ensure_space(y)

    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - MARGIN, 22, "Page 1 of 1")

    c.showPage()
    c.save()


if __name__ == "__main__":
    generate_pdf(OUTPUT_PATH)
    print(OUTPUT_PATH)
