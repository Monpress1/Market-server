const express = require('express');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create Express app
const app = express();

// Create uploads folder if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Setup static file serving (optional)
app.use('/uploads', express.static(uploadDir));

// Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname),
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ url: imageUrl });
});

// Create HTTP server and WebSocket
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket logic
wss.on('connection', (ws) => {
  console.log('✅ WebSocket connected');

  ws.on('message', (data) => {
    // Broadcast to all clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client !== ws) {
        client.send(data);
      }
    });
  });

  ws.on('close', () => console.log('❌ WebSocket disconnected'));
});

// Use Railway or fallback port
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
