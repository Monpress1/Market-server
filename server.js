const express = require('express');
const sqlite3 = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// --- Global Error Handlers ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message, error.stack);
    process.exit(1);
});

// --- App and Server Setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});
const PORT = process.env.PORT || 3000;

// --- SQLite Database Setup ---
const DATABASE_DIR = process.env.DATABASE_VOLUME_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATABASE_DIR, 'marketplace.sqlite');
const UPLOADS_DIR_NAME = 'uploads';
const UPLOADS_PATH = path.join(DATABASE_DIR, UPLOADS_DIR_NAME);

if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_PATH)) fs.mkdirSync(UPLOADS_PATH, { recursive: true });

let db;
function connectAndInitializeDB() {
    try {
        db = sqlite3(DB_FILE);
        db.pragma('journal_mode = WAL');
        db.exec(`
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                name TEXT NOT NULL,
                description TEXT,
                price REAL,
                image_url TEXT,
                whatsapp_number TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Database ready');
    } catch (err) {
        console.error('DB error:', err.message);
        process.exit(1);
    }
}
connectAndInitializeDB();

// --- Multer Upload Config ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_PATH),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + unique + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif/;
        const valid = allowed.test(file.mimetype) && allowed.test(path.extname(file.originalname).toLowerCase());
        cb(valid ? null : new Error('Only images (jpeg, jpg, png, gif) are allowed!'));
    }
});

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_PATH));

// --- WebSocket Handling ---
io.on('connection', (socket) => {
    console.log('📦 New client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
    });
});

// --- API Routes ---
app.get('/api/products', (req, res) => {
    try {
        const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
        res.json(products);
    } catch (err) {
        console.error('Fetch error:', err);
        res.status(500).json({ message: 'Error fetching products' });
    }
});

app.get('/api/products/:id', (req, res) => {
    try {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
        if (product) res.json(product);
        else res.status(404).json({ message: 'Product not found' });
    } catch (err) {
        res.status(500).json({ message: 'Error', error: err.message });
    }
});

app.post('/api/products', upload.single('productImage'), (req, res) => {
    const userId = 1;
    const { name, description, price, whatsapp_number } = req.body;
    const imageUrl = req.file ? `/uploads/${path.basename(req.file.path)}` : null;

    if (!name || !whatsapp_number) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ message: 'Product name and WhatsApp number are required.' });
    }

    try {
        const stmt = db.prepare('INSERT INTO products (user_id, name, description, price, image_url, whatsapp_number) VALUES (?, ?, ?, ?, ?, ?)');
        const info = stmt.run(userId, name, description, parseFloat(price || 0), imageUrl, whatsapp_number);

        const newProduct = {
            id: info.lastInsertRowid,
            name,
            description,
            price,
            image_url: imageUrl,
            whatsapp_number,
            created_at: new Date().toISOString()
        };

        io.emit('new_product', newProduct); // 🔴 Broadcast to all clients
        res.status(201).json({ message: 'Product uploaded', productId: info.lastInsertRowid, imageUrl });
    } catch (err) {
        console.error('Upload error:', err);
        if (req.file) fs.unlink(req.file.path, () => {});
        res.status(500).json({ message: 'Upload failed', error: err.message });
    }
});

// --- Error Middleware ---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: `Upload error: ${err.message}` });
    } else if (err) {
        console.error('Error handler:', err.message);
        return res.status(500).json({ message: `Internal server error: ${err.message}` });
    }
    next();
});

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`🚀 Server with WebSocket running on http://localhost:${PORT}`);
});
