const express = require('express');
const sqlite3 = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 3000;

// --- Database Setup ---
// Use Railway's volume mount path or a default local path
const DATABASE_DIR = process.env.DATABASE_VOLUME_PATH || path.join(__dirname, 'data');
const DB_FILE = path.join(DATABASE_DIR, 'marketplace.sqlite');
const UPLOADS_DIR_NAME = 'uploads'; // Name of the subdirectory for uploads
const UPLOADS_PATH = path.join(DATABASE_DIR, UPLOADS_DIR_NAME); // Full path for uploads

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
        db.pragma('journal_mode = WAL'); // Improve concurrency and durability

        // Create products table if it doesn't exist
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
        // Exit the process if database connection fails critically
        process.exit(1);
    }
}

// Connect to DB immediately
connectAndInitializeDB();

// --- Multer Storage Setup for Image Uploads ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_PATH); // Files will be saved in the /data/uploads directory
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
app.use(express.json()); // To parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded request bodies

// Serve static files from the 'public' directory (your frontend)
app.use(express.static('public'));

// Serve uploaded images statically
// The client will request images from /uploads/, and Express will find them in UPLOADS_PATH
app.use('/uploads', express.static(UPLOADS_PATH));

// --- API Routes ---

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

    // For now, we'll use a placeholder user_id=1. In a real app, this would come from the authenticated seller.
    const userId = 1;

    const { name, description, price, whatsapp_number } = req.body;
    const imageUrl = req.file ? `/uploads/${path.basename(req.file.path)}` : null; // Path accessible from frontend

    if (!name || !whatsapp_number) {
        // If an image was uploaded but required fields are missing, delete the image
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
        // If DB insertion fails but image was uploaded, clean up the image
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('Error deleting failed upload:', err);
            });
        }
        res.status(500).json({ message: 'Error uploading product', error: error.message });
    }
});

// --- Error Handling Middleware (IMPORTANT for Multer errors) ---
// This must be placed AFTER all your routes and AFTER app.use(express.static('public'))
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred when uploading.
        console.error('Multer Error:', err.code, err.message);
        return res.status(400).json({ message: `File upload error: ${err.message}` });
    } else if (err) {
        // An unknown error occurred.
        console.error('Unhandled Server Error:', err.message, err.stack);
        return res.status(500).json({ message: `Internal server error: ${err.message}` });
    }
    next(); // Pass to next middleware if no error
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access your marketplace at: http://localhost:${PORT} (or your Railway URL)`);
});
