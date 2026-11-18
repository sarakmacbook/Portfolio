const JPEG_DATA_PREFIX = "data:image/jpeg;base64,";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const THUMBNAIL_EDGE = 96;
// The layout action sends all 20 folders together. Keep the encoded logos well
// under Next's default 1 MB action limit, leaving space for the rest of the layout.
const MAX_THUMBNAIL_BYTES = 16 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_THUMBNAIL_BYTES / 3);

/** Only accept small, inline JPEGs from the layout payload or stored settings. */
export function normaliseFolderLogo(value: unknown): string | undefined {
  // /9j/ decodes to the first three bytes of a JPEG (FF D8 FF).
  if (typeof value !== "string" || !value.startsWith(`${JPEG_DATA_PREFIX}/9j/`)) return;
  const base64 = value.slice(JPEG_DATA_PREFIX.length);
  if (base64.length < 8 || base64.length > MAX_BASE64_LENGTH || base64.length % 4 !== 0) return;

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > MAX_THUMBNAIL_BYTES) return;
  if (/[^A-Za-z0-9+/]/.test(base64.slice(0, base64.length - padding))) return;
  if (!atob(base64.slice(-8)).endsWith("\xff\xd9")) return; // JPEG end marker
  return value;
}

/** Prepare a logo in the browser. Only the thumbnail, without metadata, is saved. */
export async function readFolderLogo(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Choose a JPEG no larger than 5 MB.");
  const bytes = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("Choose a JPG or JPEG image.");
  }

  const source = URL.createObjectURL(file.slice(0, file.size, "image/jpeg"));
  try {
    const image = new Image();
    image.src = source;
    await image.decode();

    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = normaliseFolderLogo(canvas.toDataURL("image/jpeg", 0.85));
      if (thumbnail) return thumbnail;
    }
  } catch {
    // Unreadable or unsupported JPEGs leave the current icon unchanged.
  } finally {
    URL.revokeObjectURL(source);
  }
  throw new Error("Could not read this JPEG. Try another image.");
}
