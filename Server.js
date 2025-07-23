// server.js
// This script sets up an Express.js HTTP server for a marketplace application.
// It allows users (sellers) to upload products (with images) and buyers to browse them.
// All interactions are via HTTP, and product inquiries are directed to seller's WhatsApp.
// SQLite is used for persistent storage of user and product data.

// Import necessary modules
const express = require('express');
const Database = require('better-sqlite3'); // Using better-sqlite3 for simpler synchronous API
const fs = require('fs');
const path = require('path');
const multer = require('multer'); // For handling file uploads (product images)
require('dotenv').config(); // Load environment variables from .env file

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3000; // Railway uses PORT env var for HTTP services

// --- Middleware ---
app.use(express.json()); // To parse JSON bodies from POST requests
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies (for forms)

// --- SQLite Database Configuration ---
// IMPORTANT: For Railway, this path *must* point inside your mounted volume.
// If your Railway Volume is mounted at `/data`, then `baseDataPath` will resolve to `/data`.
const DB_RELATIVE_DIR_NAME = 'data'; // Subdirectory within your app's root or volume
const DB_FILE_NAME = 'marketplace.sqlite';
const UPLOADS_DIR_NAME = 'uploads'; // Directory for uploaded product images

// Determine the base path for persistent data (DB and uploads)
// If DATABASE_VOLUME_PATH env var is set (e.g., to /data on Railway), use that.
// Otherwise, fall back to a 'data' folder in the current directory (for local development).
const baseDataPath = process.env.DATABASE_VOLUME_PATH || path.join(__dirname, DB_RELATIVE_DIR_NAME);
const DB_FILE = path.join(baseDataPath, DB_FILE_NAME);
const UPLOADS_PATH = path.join(baseDataPath, UPLOADS_DIR_NAME);

// Ensure the base data directory exists (where DB and uploads will live)
if (!fs.existsSync(baseDataPath)) {
    console.log(`Creating base data directory: ${baseDataPath}`);
    fs.mkdirSync(baseDataPath, { recursive: true });
}
// Ensure the uploads directory exists within the base data path
if (!fs.existsSync(UPLOADS_PATH)) {
    console.log(`Creating uploads directory: ${UPLOADS_PATH}`);
    fs.mkdirSync(UPLOADS_PATH, { recursive: true });
}

let db; // SQLite database instance

// --- Connect to SQLite and Initialize Tables ---
function connectAndInitializeDB() {
    return new Promise((resolve, reject) => {
        try {
            // Initialize the database connection
            db = new Database(DB_FILE, { verbose: console.log }); // verbose logs SQL queries
            console.log(`Connected to SQLite database: ${DB_FILE}`);

            // Enable foreign key constraints
            db.exec("PRAGMA foreign_keys = ON;");
            console.log('PRAGMA foreign_keys enabled.');

            // Create users table for sellers
            db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL, -- In a real app, hash this with bcrypt!
                    whatsapp_number TEXT UNIQUE NOT NULL,
                    role TEXT DEFAULT 'seller', -- 'buyer' or 'seller'
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Users table checked/created.');

            // Create products table
            db.exec(`
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    price REAL,
                    image_url TEXT, -- Path to the image file
                    whatsapp_number TEXT NOT NULL, -- Seller's WhatsApp for this product
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
            console.log('Products table checked/created.');

            resolve(); // Resolve the promise once DB is ready
        } catch (err) {
            console.error('Error connecting to or initializing SQLite database:', err.message);
            reject(err);
        }
    });
}

// --- Multer Configuration for File Uploads ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_PATH); // Store images in the persistent uploads directory
    },
    filename: function (req, file, cb) {
        // Create unique file name: timestamp-originalfilename.ext
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-').toLowerCase().replace(ext, '') + ext);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB file size limit
    fileFilter: (req, file, cb) => {
        // Allow only images
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Serve uploaded product images statically
// This makes images accessible via URLs like http://yourdomain.com/uploads/your-image.jpg
// The URL '/uploads' maps to the UPLOADS_PATH on your server.
app.use('/uploads', express.static(UPLOADS_PATH));

// --- API Routes for Marketplace Functionality ---

// 1. User Registration (for Sellers to create accounts)
app.post('/api/register', async (req, res) => {
    const { username, password, whatsapp_number } = req.body;

    if (!username || !password || !whatsapp_number) {
        return res.status(400).json({ message: 'Username, password, and WhatsApp number are required.' });
    }

    try {
        // In a production app, you MUST hash the password using bcryptjs:
        // const hashedPassword = await bcrypt.hash(password, 10);

        const stmt = db.prepare('INSERT INTO users (username, password, whatsapp_number, role) VALUES (?, ?, ?, ?)');
        const info = stmt.run(username, password, whatsapp_number, 'seller'); // Default to 'seller' role
        res.status(201).json({ message: 'Seller registered successfully', userId: info.lastInsertRowId });
    } catch (error) {
        console.error('Error registering user:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ message: 'Username or WhatsApp number already exists.' });
        }
        res.status(500).json({ message: 'Error registering user', error: error.message });
    }
});

// 2. Product Upload (for Sellers)
// This route requires authentication in a real app (e.g., checking session/JWT for user_id)
app.post('/api/products', upload.single('productImage'), async (req, res) => {
    // For now, we'll use a placeholder user_id=1. In a real app, this would come from the authenticated seller.
    const userId = 1; // Replace with req.user.id from authentication middleware

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

// 3. Get All Products (for Buyer's main listing page)
app.get('/api/products', (req, res) => {
    try {
        const products = db.prepare('SELECT id, name, description, price, image_url, whatsapp_number FROM products ORDER BY created_at DESC').all();
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Error fetching products', error: error.message });
    }
});

// 4. Get Single Product (for the pop-up detail)
app.get('/api/products/:id', (req, res) => {
    try {
        const product = db.prepare('SELECT id, name, description, price, image_url, whatsapp_number FROM products WHERE id = ?').get(req.params.id);
        if (product) {
            res.json(product);
        } else {
            res.status(404).json({ message: 'Product not found' });
        }
    } catch (error) {
        console.error('Error fetching single product:', error);
        res.status(500).json({ message: 'Error fetching product', error: error.message });
    }
});

// 5. Get Sellers (for "Switch to Seller" functionality, if you list them)
// In a real app, you might secure this or only show relevant info
app.get('/api/users/sellers', (req, res) => {
    try {
        const sellers = db.prepare('SELECT id, username, whatsapp_number FROM users WHERE role = "seller"').all();
        res.json(sellers);
    } catch (error) {
        console.error('Error fetching sellers:', error);
        res.status(500).json({ message: 'Error fetching sellers', error: error.message });
    }
});


// --- Serve Static Frontend Files ---
// Create a 'public' directory in your project root.
// All your HTML, CSS, and JavaScript files for the frontend go here.
// For example: public/index.html, public/style.css, public/script.js, public/seller-dashboard.html
app.use(express.static('public'));

// Catch-all to serve index.html for any unmatched routes (useful for SPAs)
// IMPORTANT: This should be the LAST route defined.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Server Startup ---
connectAndInitializeDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Marketplace server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to start marketplace server due to database error:', err);
    process.exit(1); // Exit process if DB connection fails
});

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    if (db) {
        console.log('Closing SQLite database...');
        db.close();
    }
    console.log('Server shutting down.');
    process.exit(0);
});
