/**
 * E2 asks how the aligner — which runs on a Mac with no Readium in the loop —
 * derives an `href` from an EPUB. Answering that needs the two strings Readium
 * never shows you: the href as written in the OPF manifest, and the path inside
 * the zip. Both are read here so all three forms can be compared side by side.
 *
 * The OPF is parsed with regexes rather than a real XML parser. That is fine for
 * a spike: a mis-parse shows up immediately as a missing or obviously wrong
 * path, and the aligner will do this properly on the Mac side.
 */

import * as FileSystem from "expo-file-system/legacy";
import { unzipSync } from "fflate";

export type EpubManifestSummary = {
  opfPath: string;
  /** Every XHTML/HTML entry, named exactly as the zip names it. */
  zipEntryPaths: string[];
  /** `href` attributes exactly as written in the OPF manifest. */
  manifestHrefs: string[];
  /** Those hrefs resolved against the OPF's own directory. */
  resolvedHrefs: string[];
  /** Reading order from the spine, resolved the same way. */
  spineHrefs: string[];
};

const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const decodeText = (bytes: Uint8Array) => {
  if (typeof TextDecoder === "function") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  let text = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    text += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return text;
};

/** Resolves an OPF-relative href against the OPF's directory, honouring `../`. */
export const resolveAgainstOpf = (opfPath: string, href: string) => {
  const opfDirectory = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/")) : "";
  const segments = opfDirectory ? opfDirectory.split("/") : [];

  for (const segment of href.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join("/");
};

const XHTML_ENTRY = /\.(x?html|htm)$/i;

export const readEpubManifest = async (bookUri: string): Promise<EpubManifestSummary> => {
  const base64 = await FileSystem.readAsStringAsync(bookUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(base64);

  // The filter runs over every entry, so entry names are collected there and
  // only the two files actually needed are inflated.
  const zipEntryPaths: string[] = [];
  const firstPass = unzipSync(bytes, {
    filter: (file) => {
      if (XHTML_ENTRY.test(file.name)) zipEntryPaths.push(file.name);
      return file.name === "META-INF/container.xml";
    },
  });
  const containerXml = firstPass["META-INF/container.xml"];

  if (!containerXml) {
    throw new Error("No META-INF/container.xml — this does not look like an EPUB.");
  }

  const opfPath = decodeText(containerXml).match(/full-path\s*=\s*"([^"]+)"/)?.[1];
  if (!opfPath) {
    throw new Error("container.xml names no OPF package document.");
  }

  const opfBytes = unzipSync(bytes, { filter: (file) => file.name === opfPath })[opfPath];
  if (!opfBytes) {
    throw new Error(`The zip has no entry at ${opfPath}.`);
  }
  const opf = decodeText(opfBytes);

  const manifestEntries = new Map<string, string>();
  const itemPattern = /<item\b[^>]*>/g;
  for (const match of opf.match(itemPattern) ?? []) {
    const href = match.match(/\bhref\s*=\s*"([^"]+)"/)?.[1];
    const id = match.match(/\bid\s*=\s*"([^"]+)"/)?.[1];
    const mediaType = match.match(/\bmedia-type\s*=\s*"([^"]+)"/)?.[1] ?? "";
    if (!href || !id) continue;
    if (!mediaType.includes("html")) continue;
    manifestEntries.set(id, href);
  }

  const spineIds = (opf.match(/<itemref\b[^>]*>/g) ?? [])
    .map((match) => match.match(/\bidref\s*=\s*"([^"]+)"/)?.[1])
    .filter((id): id is string => Boolean(id));

  const manifestHrefs = Array.from(manifestEntries.values());

  return {
    opfPath,
    zipEntryPaths,
    manifestHrefs,
    resolvedHrefs: manifestHrefs.map((href) => resolveAgainstOpf(opfPath, href)),
    spineHrefs: spineIds
      .map((id) => manifestEntries.get(id))
      .filter((href): href is string => Boolean(href))
      .map((href) => resolveAgainstOpf(opfPath, href)),
  };
};
