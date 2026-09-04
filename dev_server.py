import os
import json
import mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = 3000
HOST = '0.0.0.0'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class DevServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_GET(self):
        # Clean path
        path = self.path.split('?')[0].split('#')[0]

        if path == '/config.js':
            env_url = os.environ.get('WEB_APP_URL')
            env_pwd = os.environ.get('SITE_PASSWORD')
            if env_url or env_pwd:
                content = f'window.WEB_APP_URL = {json.dumps(env_url or "")};\nwindow.SITE_PASSWORD = {json.dumps(env_pwd or "")};\n'
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(content.encode('utf-8'))))
                self.end_headers()
                self.wfile.write(content.encode('utf-8'))
                return

            config_file = os.path.join(BASE_DIR, 'config.js')
            if os.path.exists(config_file):
                with open(config_file, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/javascript; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

            content = 'window.WEB_APP_URL = "";\nwindow.SITE_PASSWORD = "";\n'
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(content.encode('utf-8'))))
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))
            return

        # Check if local file exists
        req_path = path.lstrip('/')
        local_path = os.path.join(BASE_DIR, req_path)

        if os.path.isfile(local_path):
            return super().do_GET()

        if req_path == '' or os.path.isdir(local_path):
            index_path = os.path.join(local_path, 'index.html')
            if os.path.isfile(index_path):
                return super().do_GET()

        # SPA fallback: serve index.html
        index_file = os.path.join(BASE_DIR, 'index.html')
        if os.path.exists(index_file):
            with open(index_file, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        return super().do_GET()

if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), DevServerHandler)
    print(f"Development server running on http://localhost:{PORT} (http://{HOST}:{PORT})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
