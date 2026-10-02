import {
  getDb,
  initializeShadowDatabaseInternal,
  withWriteGuard,
} from "./shadow-db-core";

export const getPdfParagraphMap = async (
  bookId: string,
  pdfIno: string,
  pageMapAlignmentId: string,
): Promise<{ mapIno: string; artifactJson: string } | null> => {
  await initializeShadowDatabaseInternal();
  const db = await getDb();
  return db.getFirstAsync(
    `SELECT map_ino AS mapIno, artifact_json AS artifactJson FROM pdf_paragraph_maps
     WHERE library_item_id = ? AND pdf_ino = ? AND page_map_alignment_id = ?`,
    [bookId, pdfIno, pageMapAlignmentId],
  );
};

export const storePdfParagraphMap = (
  bookId: string,
  pdfIno: string,
  pageMapAlignmentId: string,
  mapIno: string,
  artifactJson: string,
) =>
  withWriteGuard(async () => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO pdf_paragraph_maps (library_item_id, pdf_ino, page_map_alignment_id, map_ino, artifact_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(library_item_id, pdf_ino) DO UPDATE SET
     page_map_alignment_id = excluded.page_map_alignment_id, map_ino = excluded.map_ino,
     artifact_json = excluded.artifact_json, updated_at = excluded.updated_at`,
      [bookId, pdfIno, pageMapAlignmentId, mapIno, artifactJson, Date.now()],
    );
  });

export const deletePdfParagraphMap = (
  bookId: string,
  pdfIno: string,
  pageMapAlignmentId: string,
) =>
  withWriteGuard(async () => {
    await initializeShadowDatabaseInternal();
    const db = await getDb();
    await db.runAsync(
      "DELETE FROM pdf_paragraph_maps WHERE library_item_id = ? AND pdf_ino = ? AND page_map_alignment_id = ?",
      [bookId, pdfIno, pageMapAlignmentId],
    );
  });
