import {
  getDb,
  initializeShadowDatabaseInternal,
  withWriteGuard,
} from "./shadow-db-core";

export type StoredPdfPageMap = {
  pdfIno: string;
  pdfFilename: string;
  mapIno: string;
  artifactJson: string;
};

export const getPdfPageMaps = async (
  libraryItemId: string,
): Promise<StoredPdfPageMap[]> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  return db.getAllAsync<StoredPdfPageMap>(
    `SELECT pdf_ino AS pdfIno, pdf_filename AS pdfFilename, map_ino AS mapIno,
      artifact_json AS artifactJson FROM pdf_page_maps WHERE library_item_id = ? ORDER BY updated_at DESC`,
    [libraryItemId],
  );
};

export const storePdfPageMap = (libraryItemId: string, map: StoredPdfPageMap) =>
  withWriteGuard(async () => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO pdf_page_maps (library_item_id, pdf_ino, pdf_filename, map_ino, artifact_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(library_item_id, pdf_ino) DO UPDATE SET
      pdf_filename = excluded.pdf_filename, map_ino = excluded.map_ino,
      artifact_json = excluded.artifact_json, updated_at = excluded.updated_at`,
      [
        libraryItemId,
        map.pdfIno,
        map.pdfFilename,
        map.mapIno,
        map.artifactJson,
        Date.now(),
      ],
    );
  });
