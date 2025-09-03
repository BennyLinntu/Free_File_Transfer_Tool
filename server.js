import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { Document, Packer, Paragraph } from "docx";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import archiver from "archiver";
import cookieParser from "cookie-parser";
import csrf from "csurf";
import morgan from "morgan";
import pino from "pino";
import { fileTypeFromFile } from "file-type";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const PORT = process.env.PORT || 3000;
const MAX_FILES = parseInt(process.env.MAX_FILES || '10', 10);
const MAX_SIZE_MB = parseInt(process.env.MAX_SIZE_MB || '25', 10);
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// Folders
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUT_DIR = path.join(__dirname, "converted");
const PUBLIC_DIR = path.join(__dirname, "public");

for (const d of [UPLOAD_DIR, OUT_DIR, PUBLIC_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Security headers
app.use(helmet({
    xPoweredBy: false,
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "style-src": ["'self'"],
            "script-src": ["'self'"],
        },
    },
}));
app.disable('x-powered-by');

// Basic rate limiting to mitigate abuse
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 min
    max: 60, // 60 req/min per IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});
app.use(limiter);
app.use(morgan('combined'));
app.use(cookieParser());

// Static site
app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: "1h" }));

// Upload setup
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const id = nanoid(8);
        const ext = path.extname(file.originalname) || "";
        cb(null, `${Date.now()}-${id}${ext}`);
    },
});
const allowedExt = new Set([".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"]);
const isImageExt = (ext) => [".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"].includes(ext);
const upload = multer({
    storage,
    limits: { fileSize: MAX_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExt.has(ext)) {
            return cb(new Error("Only PDF/DOCX/TXT files are supported"));
        }
        cb(null, true);
    },
});

// Helpers
const fsp = fs.promises;
const removeIfExists = async (p) => {
    try {
        await fsp.unlink(p);
        return true;
    } catch {
        return false;
    }
};

const toTxtFromPdf = async (filePath) => {
    const buf = await fsp.readFile(filePath);
    const data = await pdfParse(buf);
    const text = (data.text || "").trim();
    return text;
};

const toTxtFromDocx = async (filePath) => {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return (value || "").trim();
};

const txtToDocxBuffer = async (text) => {
    const paragraphs = text.split(/\r?\n/).map((line) => new Paragraph({ text: line }));
    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    return await Packer.toBuffer(doc);
};

// Check if a file starts with %PDF signature
const isPdfFile = async (filePath) => {
    try {
        const fh = await fsp.open(filePath, 'r');
        const buf = Buffer.alloc(4);
        await fh.read(buf, 0, 4, 0);
        await fh.close();
        return buf.toString('utf8') === '%PDF';
    } catch {
        return false;
    }
};

// Cleanup scheduler: delete files older than TTL
const TTL_MINUTES = parseInt(process.env.CLEAN_TTL_MIN || "30", 10); // default 30min
const TTL_MS = TTL_MINUTES * 60 * 1000;
const safeNow = () => Date.now();

const cleanupOldFiles = async (dir, ttlMs) => {
    try {
        const entries = await fsp.readdir(dir);
        const now = safeNow();
        await Promise.all(
            entries.map(async (name) => {
                const p = path.join(dir, name);
                try {
                    const st = await fsp.stat(p);
                    if (st.isFile() && now - st.mtimeMs > ttlMs) {
                        await fsp.unlink(p);
                    }
                } catch {
                    /* ignore */
                }
            })
        );
    } catch {
        /* ignore */
    }
};

const startCleanupLoop = () => {
    // run once at start and then every 10 minutes
    const run = () => {
        cleanupOldFiles(UPLOAD_DIR, TTL_MS).catch(() => { });
        cleanupOldFiles(OUT_DIR, TTL_MS).catch(() => { });
    };
    run();
    setInterval(run, 10 * 60 * 1000);
};
startCleanupLoop();

// In-memory history (last 100)
const history = [];
const addHistory = (entry) => {
    history.push(entry);
    while (history.length > 100) history.shift();
};

// MIME detection helpers
const looksLikeText = async (filePath) => {
    try {
        const buf = await fsp.readFile(filePath);
        return !buf.includes(0);
    } catch {
        return false;
    }
};

const detectMime = async (filePath) => {
    const ft = await fileTypeFromFile(filePath).catch(() => null);
    return ft ? ft.mime : null;
};

// CSRF protection on write APIs
const csrfProtection = csrf({ cookie: true });
app.get('/api/csrf', csrfProtection, (req, res) => {
    res.json({ ok: true, token: req.csrfToken() });
});

// OCR placeholder (disabled by default). To enable later, integrate tesseract.js or system tesseract.
const ocrToText = async (_buffer) => '';

// Helper to produce a DOCX buffer from text (reuse txtToDocxBuffer)

// Multi-file API: accepts one or multiple files, returns a single file or a ZIP
app.post("/api/convert", csrfProtection, upload.array("file", MAX_FILES), async (req, res) => {
    const target = (req.body?.target || "txt").toLowerCase();
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ ok: false, error: "No file uploaded" });

    const outputs = [];
    try {
        for (const uploaded of files) {
            const ext = path.extname(uploaded.originalname).toLowerCase();
            const base = path.basename(uploaded.originalname, ext);
            // light MIME/structure checks
            if (ext === '.txt') {
                if (!(await looksLikeText(uploaded.path))) {
                    outputs.push({ err: `Not a text file: ${uploaded.originalname}` });
                    continue;
                }
            } else if (ext === '.docx') {
                const m = await detectMime(uploaded.path);
                if (m && m !== 'application/zip' && m !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    outputs.push({ err: `Not a DOCX file: ${uploaded.originalname}` });
                    continue;
                }
            }
            if (target === "txt") {
                let text = "";
                if (ext === ".pdf") {
                    if (!(await isPdfFile(uploaded.path))) {
                        outputs.push({ err: `Invalid PDF file: ${uploaded.originalname}` });
                        continue;
                    }
                    text = await toTxtFromPdf(uploaded.path);
                    if (!text) {
                        // try OCR fallback for scanned PDF (very basic: user may still need full-page OCR)
                        // Note: pdf-parse doesn't give page images; OCR fallback requires pre-rendering pages.
                        // Keep message informative.
                        outputs.push({ err: `No text extracted (likely scanned PDF): ${uploaded.originalname}` });
                        continue;
                    }
                } else if (ext === ".docx") {
                    text = await toTxtFromDocx(uploaded.path);
                } else if (ext === ".txt") {
                    text = await fsp.readFile(uploaded.path, 'utf8');
                } else if (isImageExt(ext)) {
                    outputs.push({ err: `OCR not enabled for images: ${uploaded.originalname}` });
                } else {
                    outputs.push({ err: `Unsupported source for TXT: ${uploaded.originalname}` });
                    continue;
                }
                const outPath = path.join(OUT_DIR, `${base}.txt`);
                await fsp.writeFile(outPath, text, 'utf8');
                outputs.push({ path: outPath, name: `${base}.txt` });
            } else if (target === "docx") {
                let text = "";
                if (ext === ".pdf") {
                    if (!(await isPdfFile(uploaded.path))) {
                        outputs.push({ err: `Invalid PDF file: ${uploaded.originalname}` });
                        continue;
                    }
                    text = await toTxtFromPdf(uploaded.path);
                    if (!text) {
                        outputs.push({ err: `No text extracted (likely scanned PDF): ${uploaded.originalname}` });
                        continue;
                    }
                } else if (ext === ".docx") {
                    text = await toTxtFromDocx(uploaded.path);
                } else if (ext === ".txt") {
                    text = await fsp.readFile(uploaded.path, 'utf8');
                } else if (isImageExt(ext)) {
                    outputs.push({ err: `OCR not enabled for images: ${uploaded.originalname}` });
                } else {
                    outputs.push({ err: `Unsupported source for DOCX: ${uploaded.originalname}` });
                    continue;
                }
                const buffer = await txtToDocxBuffer(text);
                const outPath = path.join(OUT_DIR, `${base}.docx`);
                await fsp.writeFile(outPath, buffer);
                outputs.push({ path: outPath, name: `${base}.docx` });
            } else {
                outputs.push({ err: `Unsupported target: ${target}` });
            }
        }

        // If single successful output, return direct link; else zip successful outputs
        const okItems = outputs.filter(o => o.path);
        if (okItems.length === 0) {
            const firstErr = outputs.find(o => o.err)?.err || 'Conversion failed';
            return res.status(422).json({ ok: false, error: firstErr });
        }
        if (okItems.length === 1) {
            const one = okItems[0];
            const downloadId = nanoid(10);
            const mappedPath = path.join(OUT_DIR, `${downloadId}-${one.name}`);
            await fsp.rename(one.path, mappedPath);
            addHistory({ id: downloadId, name: one.name, count: 1, target, time: Date.now() });
            return res.json({ ok: true, url: `/download/${downloadId}/${encodeURIComponent(one.name)}` });
        }

        // Make a zip
        const zipName = `converted-${Date.now()}.zip`;
        const zipTemp = path.join(OUT_DIR, zipName);
        const output = fs.createWriteStream(zipTemp);
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(output);
        for (const item of okItems) {
            const stream = fs.createReadStream(item.path);
            archive.append(stream, { name: item.name });
        }
        await archive.finalize();
        await new Promise((resolve) => output.on('close', resolve));

        // Cleanup individual files after zipping
        await Promise.all(okItems.map(i => removeIfExists(i.path)));

        const downloadId = nanoid(10);
        const mappedPath = path.join(OUT_DIR, `${downloadId}-${zipName}`);
        await fsp.rename(zipTemp, mappedPath);
        addHistory({ id: downloadId, name: zipName, count: okItems.length, target, time: Date.now() });
        return res.json({ ok: true, url: `/download/${downloadId}/${encodeURIComponent(zipName)}` });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ ok: false, error: "Conversion failed" });
    } finally {
        // cleanup uploads
        await Promise.all((files || []).map(f => f?.path ? removeIfExists(f.path) : null));
    }
});

app.get("/download/:id/:name", (req, res) => {
    const { id, name } = req.params;
    const safeBase = path.resolve(OUT_DIR);
    const candidate = path.resolve(OUT_DIR, `${id}-${name}`);
    if (!candidate.startsWith(safeBase + path.sep) && candidate !== safeBase) {
        return res.status(400).send("Bad path");
    }
    if (!fs.existsSync(candidate)) return res.status(404).send("Not found");
    res.download(candidate, name, async (err) => {
        if (err) console.warn("Download error:", err.message);
        // keep file for history within TTL
    });
});

// History endpoint (in-memory, last 100)
app.get('/api/history', (_req, res) => {
    res.json({ ok: true, items: history.slice(-100).slice().reverse() });
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server running http://localhost:${PORT}`));

// Global error handler (including Multer)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
    console.error("Error:", err?.message || err);
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ ok: false, error: `File too large (max ${MAX_SIZE_MB}MB)` });
        }
        return res.status(400).json({ ok: false, error: `Upload error: ${err.code}` });
    }
    return res.status(400).json({ ok: false, error: err?.message || "Bad request" });
});
