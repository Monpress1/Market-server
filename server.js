const express = require('express');
const path = require('path');
const multer = require('multer');
const sqlite3 = require('better-sqlite3');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// DB setup
const db = new sqlite3('marketplace.db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price TEXT,
    image TEXT,
    contact TEXT,
    created_at TEXT
  )
`).run();

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public/uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Routes
app.post('/api/products', upload.single('image'), (req, res) => {
  const { name, price, contact } = req.body;
  const image = req.file ? '/uploads/' + req.file.filename : '';
  const created_at = new Date().toISOString();

  const stmt = db.prepare(`INSERT INTO products (name, price, image, contact, created_at) VALUES (?, ?, ?, ?, ?)`);
  stmt.run(name, price, image, contact, created_at);

  io.emit('new-product', { name, price, image, contact, created_at });

  res.json({ success: true });
});

app.get('/api/products', (req, res) => {
  const rows = db.prepare(`SELECT * FROM products ORDER BY id DESC`).all();
  res.json(rows);
});

// WebSocket setup
io.on('connection', (socket) => {
  console.log('A user connected');
  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
