const express = require('express');
const sqlite3 = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Load environment variables

// --- IMPORTANT: Add these lines at the very top for robustness ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // You might want to log more details here or send an alert
    // For a critical app, you might consider process.exit(1) to restart,
    // but for debugging, letting it log is key.
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message, error.stack);
    // This catches synchronous errors that weren't handled by try/catch
    // For a critical app, you would often exit here after logging.
    process.exit(1); // Exit cleanly so Railway can restart (and hopefully log more).
});
// --- End of critical additions ---

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
const DATABASE_DIR = process.env.DATABASE_VOLUME_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATABASE_DIR, 'marketplace.sqlite');
const UPLOADS_DIR_NAME = 'uploads';
const UPLOADS_PATH = path.join(DATABASE_DIR, UPLOADS_DIR_NAME);

// Ensure the database directory and uploads directory exist
if (!fs.existsSync(DATABASE_DIR)) {
    console.log(`Creating database directory: ${DATABASE_DIR}`);
    fs.mkdirSync(DATABASE_DIR, { recursive: true });
    console.log(`Database directory created/verified at: ${DATABASE_DIR}`);
} else {
    console.log(`Database directory already exists at: ${DATABASE_DIR}`);
}

if (!fs.existsSync(UPLOADS_PATH)) {
    console.log(`Creating uploads directory: ${UPLOADS_PATH}`);
    fs.mkdirSync(UPLOADS_PATH, { recursive: true });
    console.log(`Uploads directory created/verified at: ${UPLOADS_PATH}`);
} else {
    console.log(`Uploads directory already exists at: ${UPLOADS_PATH}`);
}

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
        console.log('Database connected and schema initialized.');
    } catch (err) {
        console.error('Error connecting to or initializing database:', err.message);
        process.exit(1); // Exit if DB connection fails critically
    }
}

connectAndInitializeDB();

// --- Multer Storage Setup ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_PATH);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB file size limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only images (jpeg, jpg, png, gif) are allowed!'));
    }
});

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- IMPORTANT: Serve static files before API routes ---
app.use(express.static(path.join(__dirname, 'public'))); // Serve your frontend files
app.use('/uploads', express.static(UPLOADS_PATH)); // Serve uploaded images

// --- API Routes ---
// These MUST be defined AFTER static file serving, otherwise static files might be served instead of API data.

// 1. Get All Products
app.get('/api/products', (req, res) => {
    try {
        const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Error fetching products', error: error.message });
    }
});

// 2. Get Product by ID
app.get('/api/products/:id', (req, res) => {
    try {
        const productId = req.params.id;
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);

        if (product) {
            res.json(product);
        } else {
            res.status(404).json({ message: 'Product not found' });
        }
    } catch (error) {
        console.error('Error fetching product by ID:', error);
        res.status(500).json({ message: 'Error fetching product', error: error.message });
    }
});

// 3. Product Upload (for Sellers)
app.post('/api/products', upload.single('productImage'), async (req, res) => {
    console.log("--- Product Upload Request Received ---");
    console.log("Request Body:", req.body);
    console.log("Uploaded File (req.file):", req.file);
    console.log("-------------------------------------");

    const userId = 1; // Placeholder for now

    const { name, description, price, whatsapp_number } = req.body;
    const imageUrl = req.file ? `/uploads/${path.basename(req.file.path)}` : null;

    if (!name || !whatsapp_number) {
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting incomplete upload:', err);
            });
        }
        return res.status(400).json({ message: 'Product name and WhatsApp number are required.' });
    }

    try {
        const stmt = db.prepare('INSERT INTO products (user_id, name, description, price, image_url, whatsapp_number) VALUES (?, ?, ?, ?, ?, ?)');
        const info = stmt.run(userId, name, description, parseFloat(price || 0), imageUrl, whatsapp_number);
        res.status(201).json({ message: 'Product uploaded successfully', productId: info.lastInsertRowId, imageUrl });
    } catch (error) {
        console.error('Error uploading product:', error);
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting failed upload:', err);
            });
        }
        res.status(500).json({ message: 'Error uploading product', error: error.message });
    }
});

// --- IMPORTANT: General Error Handling Middleware (AFTER all routes) ---
// This middleware catches errors passed by 'next(err)' from routes/other middleware
// and also catches Multer-specific errors.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.error('Multer Error:', err.code, err.message);
        return res.status(400).json({ message: `File upload error: ${err.message}` });
    } else if (err) {
        console.error('Unhandled Server Error (Caught by Express Default):', err.message, err.stack);
        return res.status(500).json({ message: `Internal server error: ${err.message}` });
    }
    next();
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access your marketplace at: http://localhost:${PORT} (or your Railway URL)`);
});
