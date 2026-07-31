import path from "node:path";
import { config } from "../config";

/**
 * Résout un `audioFileId` vers un chemin de fichier local.
 * Hypothèse : les fichiers audio sont uploadés (par un endpoint dédié,
 * hors périmètre de cette spec) sous `AUDIO_UPLOADS_DIR/<audioFileId>`.
 */
export function resolveAudioFile(audioFileId: string): string {
  const safeId = path.basename(audioFileId);
  return path.join(config.audioUploadsDir, safeId);
}
