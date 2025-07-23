// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const multer = require('multer');
const WebSocket = require('ws');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store products in memory
let products = [];

// Setup file upload destination
const storage = multer.diskStorage({
  destination: 'public/uploads/',
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

app.use(express.static('public'));

// Serve frontend fallback
app.get('/', (req, res) => {
  res.send('WebSocket Marketplace Server is running.');
});

// WebSocket logic
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send current product list
  ws.send(JSON.stringify({ type: 'init', products }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'addProduct') {
        products.push(data.product);
        broadcast({ type: 'newProduct', product: data.product });
      }
    } catch (err) {
      console.error('Invalid WS message:', err.message);
    }
  });

  ws.on('close', () => console.log('Client disconnected'));
});

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Image upload endpoint (still HTTP-based)
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename });
});

// Port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
