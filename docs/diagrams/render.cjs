const fs = require('fs');
const path = require('path');
const { Resvg } = require('../../.cache/diagram-renderer/node_modules/@resvg/resvg-js');
for (const name of fs.readdirSync(__dirname).filter(n => n.endsWith('.svg'))) {
 const renderer = new Resvg(fs.readFileSync(path.join(__dirname,name)), { background: '#ffffff', font: { loadSystemFonts: true, defaultFontFamily: 'Arial' }});
 fs.writeFileSync(path.join(__dirname,name.replace('.svg','.png')),renderer.render().asPng());
}
console.log('Rendered PNG diagrams.');
