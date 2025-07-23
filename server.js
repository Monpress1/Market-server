const express = require("express");
const app = express();
const http = require("http").createServer(app);
const WebSocket = require("ws");
const wss = new WebSocket.Server({ server: http });

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const db = new Database("market.db");
const PORT = process.env.PORT || 3000;

// Setup DB
db.prepare(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT,
    description TEXT,
    price REAL,
    image TEXT,
    whatsapp TEXT
  )
`).run();

// Multer config
const upload = multer({ dest: "uploads/" });

// Middleware
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use(express.json());

// Get products
app.get("/api/products", (req, res) => {
  try {
    const products = db.prepare("SELECT * FROM products ORDER BY id DESC").all();
    res.json(products);
  } catch (e) {
    console.error("DB error:", e);
    res.status(500).json([]);
  }
});

// Upload product
app.post("/api/upload", upload.single("image"), (req, res) => {
  const { name, description, price, whatsapp } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : null;

  if (!name || !price || !whatsapp || !image) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  db.prepare(`
    INSERT INTO products (name, description, price, image, whatsapp)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description, price, image, whatsapp);

  const newProduct = { name, description, price, image, whatsapp };

  // Notify all connected WebSocket clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "new-product", product: newProduct }));
    }
  });

  res.json({ success: true, product: newProduct });
});

// WebSocket connection
wss.on("connection", socket => {
  console.log("WebSocket client connected.");
  socket.send(JSON.stringify({ type: "welcome", message: "Connected!" }));
});

// Start server
http.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
