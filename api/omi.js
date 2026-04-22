const https = require('https');
const querystring = require('querystring');

function request(url, { method='GET', headers={}, body=null, jar=[] } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      }
    };
    const req = https.request(opts, res => {
      const chunks = [];
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        setCookie.forEach(c => jar.push(c.split(';')[0]));
      }
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieHeader(jar) { return jar.join('; '); }
function normalize(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function firstMatch(html, re) { const m = html.match(re); return m ? m[1] : null; }
function parseOptions(html, selectName) {
  const rx = new RegExp(`<select[^>]*name="${selectName}"[\\s\\S]*?<\\/select>`, 'i');
  const block = html.match(rx)?.[0] || '';
  const options = [];
  const optRe = /<option value="([^"]*)"[^>]*>([^<]*)<\/option>/gi;
  let m;
  while ((m = optRe.exec(block))) options.push({ value: m[1], label: m[2].replace(/\s+/g,' ').trim() });
  return options;
}
function parseTable(html) {
  const rows = [];
  const rowRe = /<tr><td class="sin">([^<]+)<\/td><td class="sin">([^<]+)<\/td><td class="dx" headers="vm vmmin">([^<]+)<\/td><td class="dx" headers="vm vmmax">([^<]+)<\/td><td class="center">([^<]+)<\/td><td class="dx" headers="vl vlmax">([^<]+)<\/td><td class="dx" headers="vl vlmax">([^<]+)<\/td><td class="center">([^<]+)<\/td><\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html))) rows.push({ tipologia:m[1], stato:m[2], compraMin:m[3], compraMax:m[4], compraSup:m[5], locMin:m[6], locMax:m[7], locSup:m[8] });
  return rows;
}

module.exports = async (req, res) => {
  try {
    const city = normalize(req.query.city || 'Bologna');
    const street = normalize(req.query.street || 'Via Indipendenza');
    const desiredUtilizzo = normalize(req.query.utilizzo || 'Commerciale');
    const jar = [];
    const base = 'https://www1.agenziaentrate.gov.it/servizi/Consultazione/ricerca.php';

    await request(base, { jar });
    let r = await request(base, { method:'POST', jar, headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cookieHeader(jar)}, body: querystring.stringify({ level:'1', lingua:'IT', pr:'BO' }) });
    const html1 = r.body;
    const provinceCode = firstMatch(html1, /<option value="(BO)"[^>]*>BOLOGNA<\/option>/i) || 'BO';
    const comm = parseOptions(html1, 'co').find(o => o.label.toLowerCase().includes(city));
    if (!comm) return res.status(404).json({ error:'Comune non trovato nel DB OMI', city });

    r = await request(base, { method:'POST', jar, headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cookieHeader(jar)}, body: querystring.stringify({ level:'2', lingua:'IT', pr:provinceCode, co:comm.value, anno_semestre:'20252' }) });
    const html2 = r.body;
    const sem = '20252';
    const zone = parseOptions(html2, 'linkzonastrada').find(o => /CENTRO STORICO|CENTRO|INDIPENDENZA/i.test(o.label)) || parseOptions(html2, 'linkzonastrada')[0];
    if (!zone) return res.status(404).json({ error:'Zona OMI non trovata', city, comune: comm.label });

    r = await request(base, { method:'POST', jar, headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cookieHeader(jar)}, body: querystring.stringify({ level:'4', lingua:'IT', pr:provinceCode, co:comm.value, anno_semestre:sem, linkzonastrada:zone.value }) });
    const html3 = r.body;
    const util = parseOptions(html3, 'utilizzo').find(o => o.label.toLowerCase() === desiredUtilizzo) || parseOptions(html3, 'utilizzo')[1] || parseOptions(html3, 'utilizzo')[0];
    if (!util) return res.status(404).json({ error:'Utilizzo non trovato', city, zone: zone.label });

    r = await request('https://www1.agenziaentrate.gov.it/servizi/Consultazione/risultato.php', {
      method:'POST',
      jar,
      headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':cookieHeader(jar)},
      body: querystring.stringify({ pr:provinceCode, co:comm.value, anno_semestre:sem, linkzona:zone.value, idstrada:'', fasciazona:firstMatch(html3, /name="fasciazona" value="([^"]+)"/i) || '', codzona:firstMatch(html3, /name="codzona" value="([^"]+)"/i) || '', lingua:'IT', level:'4', utilizzo: util.label, bt1:'Mostra valori' })
    });
    const finalHtml = r.body;
    const rows = parseTable(finalHtml);
    return res.status(200).json({
      query: { city: comm.label, street, semestre: sem, zona: zone.label, utilizzo: util.label },
      sources: [
        { name:'Agenzia delle Entrate — OMI', url:'https://www.agenziaentrate.gov.it/portale/web/guest/schede/fabbricatiterreni/omi/banche-dati/quotazioni-immobiliari' },
        { name:'Consultazione OMI', url:'https://www1.agenziaentrate.gov.it/servizi/Consultazione/ricerca.php' }
      ],
      resultHtmlFound: rows.length > 0,
      rows
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
