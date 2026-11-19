import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHoldingsFolders } from "../src/lib/dashboard-layout-save";
import { normaliseFolderLogo, readFolderLogo } from "../src/lib/folder-logo";
import { makeFolder, normaliseFolders, updateFolder } from "../src/lib/holdings-folders";

const JPEG_PREFIX = "data:image/jpeg;base64,";
// A 4×3 solid-colour JPEG.
const JPEG_BASE64 =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/" +
  "2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAD" +
  "AAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAA" +
  "AAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ8AjFX/2Q==";
const JPEG = JPEG_PREFIX + JPEG_BASE64;

test("stored logos must be bounded inline JPEGs", () => {
  assert.equal(normaliseFolderLogo(JPEG), JPEG);
  for (const invalid of [
    undefined,
    "https://example.com/logo.jpeg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    JPEG.replace("image/jpeg", "image/png"),
    JPEG.replace("/2Q==", "/3Q=="), // broken end marker
    JPEG.replace("/2Q==", "*2Q=="), // malformed base64
    JPEG.replace(/=$/, "\n"), // whitespace is not valid in a stored logo
  ]) {
    assert.equal(normaliseFolderLogo(invalid), undefined);
  }
  const tooLarge = Buffer.alloc(16 * 1024 + 1);
  tooLarge.set([0xff, 0xd8, 0xff]);
  tooLarge.set([0xff, 0xd9], tooLarge.length - 2);
  assert.equal(normaliseFolderLogo(JPEG_PREFIX + tooLarge.toString("base64")), undefined);
});

test("the file picker rejects mislabeled and oversized files before decoding", async () => {
  await assert.rejects(
    readFolderLogo(new File(["not an image"], "bad.jpg", { type: "image/jpeg" })),
    /Choose a JPG, PNG, WebP or GIF/,
  );
  await assert.rejects(
    readFolderLogo(new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" })),
    /Choose a JPG, PNG, WebP or GIF/,
  );
  await assert.rejects(
    readFolderLogo(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpeg")),
    /no larger than 5 MB/,
  );
});

test("PNG, WebP and GIF files from the file picker become bounded JPEG logos", async () => {
  const signatures = {
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    webp: [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")],
    gif: [...Buffer.from("GIF89a")],
  };
  const mimeTypes = { png: "image/png", webp: "image/webp", gif: "image/gif" };

  // Node has no canvas, so give the browser helpers minimal stand-ins. The
  // important part is that each signature is recognised and re-encoded as a
  // JPEG thumbnail on a white base (transparent PNGs would go black otherwise).
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = {
    Image: globals.Image,
    document: globals.document,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  let whiteFill = 0;
  globals.Image = class {
    src = "";
    naturalWidth = 200;
    naturalHeight = 100;
    decode() { return Promise.resolve(); }
  };
  globals.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        set fillStyle(_value: string) {},
        fillRect() { whiteFill += 1; },
        drawImage() {},
      }),
      toDataURL: (type: string) => type === "image/jpeg" ? JPEG : "",
    }),
  };
  URL.createObjectURL = () => "blob:logo";
  URL.revokeObjectURL = () => {};

  try {
    for (const [format, signature] of Object.entries(signatures)) {
      const type = mimeTypes[format as keyof typeof mimeTypes];
      const file = new File([new Uint8Array(signature)], `logo.${format}`, { type });
      assert.equal(await readFolderLogo(file), JPEG);
    }
    assert.equal(whiteFill, 3, "each picked image is flattened before JPEG encoding");
  } finally {
    globals.Image = previous.Image;
    globals.document = previous.document;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  }
});

test("logos survive the layout JSON round-trip and unrelated folder edits", () => {
  const folder = makeFolder({ name: "Accounts" }, []);
  assert.ok(folder);
  const edited = updateFolder([folder], folder.id, { icon: "image", imageDataUrl: JPEG });
  assert.equal(edited[0].icon, "image");
  assert.equal(edited[0].imageDataUrl, JPEG);
  assert.equal(edited[0].glyph, "");

  const restored = normaliseFolders(parseHoldingsFolders(JSON.stringify(edited)));
  assert.deepEqual(restored, edited);
  const renamed = updateFolder(restored, folder.id, { name: "Savings", collapsed: true });
  assert.equal(renamed[0].imageDataUrl, JPEG);
  assert.equal(renamed[0].icon, "image");

  for (const patch of [
    { icon: "auto" },
    { icon: "exchange", glyph: "dexscreener" },
    { icon: "emoji", glyph: "🌱" },
  ] as const) {
    const [switched] = updateFolder(renamed, folder.id, patch);
    assert.equal(switched.icon, patch.icon);
    assert.ok(!("imageDataUrl" in switched));
  }
});

test("bad images are rejected on save and fall back to letters in stored folders", () => {
  const invalid = { id: "accounts", name: "Accounts", icon: "image", imageDataUrl: "https://example.com/logo.jpg" };
  const payload = JSON.stringify([invalid]);
  assert.throws(() => parseHoldingsFolders(payload), /logo for Accounts is invalid/);
  const [fallback] = normaliseFolders(payload);
  assert.equal(fallback.icon, "auto");
  assert.ok(!("imageDataUrl" in fallback));
});
