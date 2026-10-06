// PDF pages for the attachment viewer. pdf.js is large, so it is only loaded when someone opens a PDF, and everything it needs (the
// worker, the picture decoders for scanned pages, the standard fonts) comes from Post's own files, never from another website.

type Pdfjs = typeof import('pdfjs-dist');
export type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

const decoders = import.meta.glob('/node_modules/pdfjs-dist/wasm/*.wasm', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
const fonts = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

/** Gives pdf.js the small files it asks for by name (fonts for PDFs that do not carry their own, decoders for scanned pictures). */
class Files {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const dir = kind === 'wasmUrl' ? 'wasm' : kind === 'standardFontDataUrl' ? 'standard_fonts' : '';
    const find = (dir === 'wasm' ? decoders : dir ? fonts : {})[`/node_modules/pdfjs-dist/${dir}/${filename}`];
    if (!find) throw new Error(`${filename} is not part of Post`);
    const res = await fetch(await find());
    if (!res.ok) throw new Error(`${filename} could not be loaded`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

let loading: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= (async () => {
    // Phones from before 2024 do not have this, and pdf.js uses it.
    const P = Promise as unknown as { withResolvers?: () => unknown };
    if (!P.withResolvers) P.withResolvers = function <T>() { let resolve!: (v: T | PromiseLike<T>) => void, reject!: (e?: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
    const lib = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as Pdfjs;
    lib.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
    return lib;
  })();
  loading.catch(() => { loading = null; }); // a failed load (offline) is tried again next time
  return loading;
}

/** Opens a PDF from its bytes (a copy is handed over, so the original stays usable for saving). `close` frees everything it holds. */
export async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDoc; close: () => void }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: bytes.slice(), BinaryDataFactory: Files, useWorkerFetch: false, isEvalSupported: false, enableXfa: false } as Parameters<Pdfjs['getDocument']>[0]);
  const doc = await task.promise;
  return { doc, close: () => { void task.destroy().catch(() => {}); } };
}
