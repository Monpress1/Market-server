const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const products = [
  {
    name: 'Rice 25kg',
    description: 'Premium long grain rice',
    price: 14000,
    image: 'rice.jpg',
    whatsapp: '2347012345678'
  },
  {
    name: 'Red Oil 5L',
    description: 'Pure red palm oil',
    price: 6000,
    image: 'oil.jpg',
    whatsapp: '2348098765432'
  }
];

// Handle WebSocket connection
wss.on('connection', (ws) => {
  console.log('Client connected via WebSocket');

  ws.on('message', (msg) => {
    const data = JSON.parse(msg);
    if (data.type === 'getProducts') {
      ws.send(JSON.stringify({ type: 'products', data: products }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
