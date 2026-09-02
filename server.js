import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Dynamic config.js endpoint to inject environment variables or fallback to local file
app.get('/config.js', (req, res) => {
  if (process.env.WEB_APP_URL || process.env.SITE_PASSWORD) {
    res.type('application/javascript');
    const webAppUrl = process.env.WEB_APP_URL || '';
    const sitePassword = process.env.SITE_PASSWORD || '';
    return res.send(`window.WEB_APP_URL = ${JSON.stringify(webAppUrl)};\nwindow.SITE_PASSWORD = ${JSON.stringify(sitePassword)};\n`);
  }
  const configPath = path.join(__dirname, 'config.js');
  if (fs.existsSync(configPath)) {
    return res.sendFile(configPath);
  }
  res.type('application/javascript');
  res.send('window.WEB_APP_URL = "";\nwindow.SITE_PASSWORD = "";\n');
});

// Serve static files from root directory
app.use(express.static(__dirname));

// Fallback for HTML5 navigation
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
