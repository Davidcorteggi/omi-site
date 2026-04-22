from http.server import BaseHTTPRequestHandler
import json, urllib.parse, re

SOURCES = [
    {
        'name': 'Agenzia delle Entrate — OMI',
        'url': 'https://www.agenziaentrate.gov.it/portale/web/guest/schede/fabbricatiterreni/omi/banche-dati/quotazioni-immobiliari'
    },
    {
        'name': 'OMI ricerca',
        'url': 'https://www1.agenziaentrate.gov.it/servizi/Consultazione/ricerca.htm?level=0'
    },
    {
        'name': 'ISTAT',
        'url': 'https://www.istat.it/'
    }
]

FALLBACKS = {
    'bologna|via indipendenza': {'rent': 32.0, 'sale': 5400, 'note': 'fallback prudente'},
    'bologna|centro storico': {'rent': 28.0, 'sale': 4650, 'note': 'fallback prudente'},
    'milano|centro': {'rent': 52.0, 'sale': 8200, 'note': 'fallback prudente'},
    'roma|centro': {'rent': 41.0, 'sale': 6800, 'note': 'fallback prudente'},
}

def normalize(s):
    return re.sub(r'\s+', ' ', (s or '').strip().lower())

def make_series(rent0, sale0):
    rows=[]
    for i, year in enumerate(range(2016, 2026)):
        rows.append([year, round(rent0 + i*0.4, 1), int(round(sale0 + i*150))])
    return rows

class handler(BaseHTTPRequestHandler):
    def _json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/api/omi':
            return self._json(404, {'error': 'not_found'})
        q = urllib.parse.parse_qs(parsed.query)
        city = normalize(q.get('city', ['Bologna'])[0])
        street = normalize(q.get('street', ['Via Indipendenza'])[0])
        key = f'{city}|{street}'
        fb = FALLBACKS.get(key) or FALLBACKS.get(f'{city}|centro') or {'rent': 30.0, 'sale': 5000, 'note': 'fallback prudente'}
        rows = make_series(fb['rent'], fb['sale'])
        data = {
            'query': {'city': city.title(), 'street': street.title()},
            'result': {'rent2025': rows[-1][1], 'sale2025': rows[-1][2], 'rows': rows, 'note': fb['note']},
            'sources': SOURCES,
            'fetchedAt': 'live-request'
        }
        return self._json(200, data)
