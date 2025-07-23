const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const products = [];

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Handle file uploads via POST (just image file)
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (_, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  return res.json({ filename: req.file.filename });
});

wss.on('connection', ws => {
  console.log('✅ Client connected');

  // Send all products on new connection
  ws.send(JSON.stringify({ type: 'all-products', products }));

  // Handle incoming messages
  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'new-product') {
        products.push(data.product);
        // Broadcast to all clients
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'product-added', product: data.product }));
          }
        });
      }
    } catch (e) {
      console.error('❌ Error parsing message:', e);
    }
  });

  ws.on('close', () => console.log('❌ Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
