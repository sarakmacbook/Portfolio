const JPEG_DATA_PREFIX = "data:image/jpeg;base64,";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const THUMBNAIL_EDGE = 96;
// The layout action sends all 20 folders together. Keep the encoded logos well
// under Next's default 1 MB action limit, leaving space for the rest of the layout.
const MAX_THUMBNAIL_BYTES = 16 * 1024;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_THUMBNAIL_BYTES / 3);

/**
 * Image formats accepted from the device's file picker. All of them are
 * converted to a small JPEG thumbnail by `readFolderLogo`, so storage (and the
 * server-side validation) keeps dealing with one bounded inline format.
 */
const IMAGE_SIGNATURES: Array<{ mime: string; matches: (bytes: Uint8Array) => boolean }> = [
  {
    mime: "image/jpeg",
    matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  {
    mime: "image/png",
    matches: (bytes) =>
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  {
    mime: "image/webp",
    matches: (bytes) =>
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP",
  },
  {
    mime: "image/gif",
    matches: (bytes) => {
      const header = String.fromCharCode(...bytes.slice(0, 6));
      return header === "GIF87a" || header === "GIF89a";
    },
  },
];

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

/**
 * Prepare a logo picked from a file on the device. JPEG, PNG, WebP and GIF are
 * all readable; the result is always a bounded JPEG data URL, which is what
 * the saved layout accepts.
 */
export async function readFolderLogo(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Choose an image no larger than 5 MB.");
  // Read enough bytes for the longest signature (PNG's eight bytes, WebP's
  // twelve) and check the content, not just the file extension / MIME label.
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const format = IMAGE_SIGNATURES.find(({ matches }) => matches(bytes));
  if (!format) throw new Error("Choose a JPG, PNG, WebP or GIF image.");

  const source = URL.createObjectURL(file.slice(0, file.size, format.mime));
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
      // PNG and WebP logos can be transparent; a white base keeps them legible
      // once the thumbnail is encoded as a JPEG.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = normaliseFolderLogo(canvas.toDataURL("image/jpeg", 0.85));
      if (thumbnail) return thumbnail;
    }
  } catch {
    // Unreadable or unsupported images leave the current icon unchanged.
  } finally {
    URL.revokeObjectURL(source);
  }
  throw new Error("Could not read this image. Try another file.");
}
