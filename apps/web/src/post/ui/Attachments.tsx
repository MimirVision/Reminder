import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Opened } from '../core/controller.ts';
import { extOf, fileKind, kindWord, mimeOf, tileLabel, viewable } from '../core/files.ts';
import { fileSize } from '../core/format.ts';
import { safeBlobType, shareType } from '../core/html.ts';
import type { AttachmentRef, Mail } from '../core/types.ts';
import { useC } from './ctx.tsx';
import { openPdf, type PdfDoc } from './pdf.ts';
import { Icon } from './ui.tsx';

// What is attached to a message: a list of files, and a viewer that shows a PDF, a picture or a text file inside Post and lets you save
// or share any file (on an iPhone: Save to Files, or open it in another app).

const SHOW_FIRST = 4;

/** One row per file. Tapping a row opens the viewer. */
export function FileList({ m, files, failed, onRetry }: { m: Mail; files: AttachmentRef[]; failed: boolean; onRetry: () => void }) {
  const [open, setOpen] = useState<AttachmentRef | null>(null);
  const [all, setAll] = useState(false);
  if (!files.length && !failed) return null;
  const shown = all ? files : files.slice(0, SHOW_FIRST);
  return (
    <>
      <div className="files" role="list" aria-label="Attachments">
        {shown.map((a) => (
          <button key={a.id} role="listitem" className="file" onClick={() => setOpen(a)} aria-label={`Open ${a.name}`}>
            <span className="fi">{tileLabel(a.name, a.kind)}</span>
            <span className="fn"><b>{a.name}</b><span>{kindWord(fileKind(a.name, a.contentType))}{a.size ? ` · ${fileSize(a.size)}` : ''}</span></span>
            <Icon n="chev" size={18} className="fc" />
          </button>
        ))}
        {files.length > SHOW_FIRST && !all && <button className="file more-files" onClick={() => setAll(true)}>Show all {files.length} files</button>}
        {failed && <div className="file warn-row"><span>The list of files could not be loaded.</span><button onClick={onRetry}>Try again</button></div>}
      </div>
      {open && <AttachmentViewer m={m} a={open} onClose={() => setOpen(null)} />}
    </>
  );
}

type Load = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; file: Opened };

const asFile = (f: Opened) => new File([f.bytes as BlobPart], f.name, { type: shareType(f.type, f.name) });
const canShare = (f: Opened) => { try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [asFile(f)] }); } catch { return false; } };

/** The way to put a file on a phone: the share sheet has Save to Files and every app that can open it. Called straight from a tap. */
async function shareFile(f: Opened): Promise<'shared' | 'cancelled' | 'failed'> {
  try { await navigator.share({ files: [asFile(f)], title: f.name }); return 'shared'; } catch (e) { return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'failed'; }
}

function downloadFile(f: Opened) {
  const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url; a.download = f.name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const ZOOMS = [1, 1.5, 2, 3];

function AttachmentViewer({ m, a, onClose }: { m: Mail; a: AttachmentRef; onClose: () => void }) {
  const c = useC();
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [tries, setTries] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({ phase: 'loading' }); setPdfError(null);
    c.openAttachment(m, a).then((file) => { if (live) setLoad({ phase: 'ready', file }); })
      .catch((e) => { if (live) setLoad({ phase: 'error', message: e instanceof Error ? e.message : 'Could not open this file' }); });
    return () => { live = false; };
  }, [c, m, a, tries]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const file = load.phase === 'ready' ? load.file : null;
  const how = file && !file.link ? viewable(a.name, file.type) : null;
  // Asking the browser means making a copy of the file, so it is asked once per file and not on every redraw.
  const shareable = useMemo(() => !!file && !file.link && canShare(file), [file]);
  const zoomable = (how === 'pdf' && !pdfError) || how === 'image';
  const host = document.querySelector('.post') ?? document.body;
  const share = async () => {
    if (!file) return;
    const r = await shareFile(file);
    if (r === 'failed') { downloadFile(file); c.toast('Saved to your downloads'); }
  };

  return createPortal(
    <div className="viewer" role="dialog" aria-label={a.name}>
      <div className="vh">
        <button className="btn" aria-label="Close" onClick={onClose}><Icon n="x" /></button>
        <div className="vt"><b>{a.name}</b><span>{kindWord(fileKind(a.name, file?.type ?? a.contentType))}{a.size ? ` · ${fileSize(a.size)}` : ''}</span></div>
        {shareable && <button className="btn" aria-label="Save or share" onClick={() => void share()}><Icon n="share" /></button>}
        {file && !file.link && <button className="btn" aria-label="Download" onClick={() => downloadFile(file)}><Icon n="download" /></button>}
      </div>
      <div className="vb">
        {load.phase === 'loading' && <div className="vmsg"><span className="spin" aria-hidden="true" />Opening…</div>}
        {load.phase === 'error' && <div className="vmsg"><b>Could not open this file</b><span>{load.message}</span><button className="alt" onClick={() => setTries((n) => n + 1)}>Try again</button></div>}
        {file?.link && <div className="vmsg"><span className="fi big">{tileLabel(a.name, 'link')}</span><b>{a.name}</b><span>This is a link to a file in the cloud, not a file in the message.</span><a className="cta" href={file.link} target="_blank" rel="noopener noreferrer"><Icon n="external" size={18} />Open it</a></div>}
        {file && !file.link && how === 'pdf' && !pdfError && <PdfPages bytes={file.bytes} zoom={ZOOMS[zoom]} onFail={setPdfError} />}
        {file && !file.link && how === 'image' && <ImageView file={file} zoom={ZOOMS[zoom]} />}
        {file && !file.link && how === 'text' && <TextView file={file} />}
        {file && !file.link && (!how || pdfError) && <Unviewable a={a} file={file} reason={pdfError} onShare={shareable ? () => void share() : null} />}
      </div>
      {zoomable && (
        <div className="vzoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}><Icon n="minus" size={20} /></button>
          <span>{Math.round(ZOOMS[zoom] * 100)}%</span>
          <button aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}><Icon n="plus" size={20} /></button>
        </div>
      )}
    </div>,
    host,
  );
}

/** A file Post does not draw itself (Word, Excel, a zip ...): the way out is Save, which on an iPhone offers every app that can open it. */
function Unviewable({ a, file, reason, onShare }: { a: AttachmentRef; file: Opened; reason: string | null; onShare: (() => void) | null }) {
  const ext = extOf(a.name);
  return (
    <div className="vmsg">
      <span className="fi big">{tileLabel(a.name, a.kind)}</span>
      <b>{file.name}</b>
      <span>{reason ?? `${kindWord(fileKind(a.name, file.type))}${ext ? ` (.${ext})` : ''}, ${fileSize(file.bytes.byteLength)}. Post cannot show this kind of file itself.`}</span>
      <div className="vbtns">
        {onShare && <button className="cta" onClick={onShare}><Icon n="share" size={18} />Save or open in…</button>}
        <button className={onShare ? 'alt' : 'cta'} onClick={() => downloadFile(file)}><Icon n="download" size={18} />Download</button>
      </div>
    </div>
  );
}

function ImageView({ file, zoom }: { file: Opened; zoom: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: safeBlobType(mimeOf(file.name, file.type), file.name) }));
    setUrl(u); setBad(false);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  if (bad) return <div className="vmsg"><b>This picture cannot be shown here</b><span>Use Save, then open it in Photos.</span></div>;
  return url ? <div className="vimg"><img src={url} alt={file.name} style={zoom === 1 ? { maxWidth: '100%' } : { width: `${zoom * 100}%`, maxWidth: 'none' }} onError={() => setBad(true)} /></div> : null;
}

const TEXT_LIMIT = 200_000;

function TextView({ file }: { file: Opened }) {
  const head = file.bytes.subarray(0, TEXT_LIMIT);
  if (head.includes(0)) return <Unviewable a={{ id: '', name: file.name, size: file.bytes.byteLength, contentType: file.type, inline: false }} file={file} reason="This file is not plain text." onShare={null} />;
  const text = new TextDecoder('utf-8').decode(head);
  return <div><pre className="vtext">{text}</pre>{file.bytes.byteLength > TEXT_LIMIT && <p className="note">Only the first part is shown here. Download the file to see all of it.</p>}</div>;
}

// ---- PDF pages -------------------------------------------------------------------------------------------------------------------------

function PdfPages({ bytes, zoom, onFail }: { bytes: Uint8Array; zoom: number; onFail: (why: string) => void }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    let close: (() => void) | null = null;
    openPdf(bytes).then((d) => { if (dead) { d.close(); return; } close = d.close; setDoc(d.doc); },
      (e) => { if (!dead) onFail(/password/i.test(String(e?.message ?? e)) ? 'This PDF is locked with a password. Download it and open it with the password.' : 'Post could not draw this PDF. Download it to open it in another app.'); });
    return () => { dead = true; close?.(); };
  }, [bytes, onFail]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = Math.max(200, (width - 16) * zoom);
  return (
    <div ref={box} className="pdf">
      {!doc && <div className="vmsg"><span className="spin" aria-hidden="true" />Drawing the pages…</div>}
      <div className="pdf-in" style={{ width: Math.max(width, w + 16) }}>
        {doc && width > 0 && Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} width={w} />)}
      </div>
    </div>
  );
}

/** One page. It is drawn only while it is near the screen and wiped when it is far away, so a long PDF does not fill the phone's memory. */
function PdfPage({ doc, n, width }: { doc: PdfDoc; n: number; width: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [near, setNear] = useState(n <= 2);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    if (!near) { if (cv) { cv.width = 0; cv.height = 0; } return; }
    let dead = false;
    let task: { promise: Promise<unknown>; cancel(): void } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (dead || !cv) return;
      setRatio(base.height / base.width);
      // Sharp on a phone (twice the pixels), but never more pixels than a phone can hold in one picture.
      let out = Math.min(window.devicePixelRatio || 1, 2);
      const area = (width / base.width) ** 2 * base.width * base.height;
      if (area * out * out > 12_000_000) out = Math.sqrt(12_000_000 / area);
      const viewport = page.getViewport({ scale: (width / base.width) * out });
      cv.width = Math.floor(viewport.width); cv.height = Math.floor(viewport.height);
      cv.style.width = `${width}px`; cv.style.height = `${Math.round(width * (base.height / base.width))}px`;
      task = page.render({ canvas: cv, viewport });
      await task.promise;
      page.cleanup();
      if (!dead) setFailed(false);
    })().catch((e) => { if (!dead && !/cancel/i.test(String(e?.name ?? e?.message ?? e))) setFailed(true); });
    return () => { dead = true; task?.cancel(); };
  }, [near, width, doc, n]);

  return (
    <div ref={wrap} className="pdf-page" style={{ width, height: Math.round(width * ratio) }}>
      <canvas ref={canvas} role="img" aria-label={`Page ${n} of ${doc.numPages}`} />
      {failed && <span className="pdf-fail">This page could not be drawn</span>}
    </div>
  );
}
