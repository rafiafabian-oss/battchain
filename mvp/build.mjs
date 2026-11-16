// Membangun web/mvp.html: satu file HTML berisi EVM (@ethereumjs/vm) + kontrak BattChain hasil `npx hardhat compile`.
import { build } from 'esbuild';
import fs from 'fs';

await build({
  entryPoints: ['app.mjs'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  outfile: 'dist/app.js',
  loader: { '.txt': 'text', '.sol': 'text' },
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  legalComments: 'none',
  logLevel: 'warning',
});
const js = fs.readFileSync('dist/app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const body = fs.readFileSync('template.html', 'utf8').replace('<!--APP-->', () => `<script>\n${js}\n</script>`);
const html = `<!doctype html>\n<html lang="id">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${body.replace('<header class="band">', '</head>\n<body>\n<header class="band">')}\n</body>\n</html>\n`;
fs.writeFileSync('../web/mvp.html', html);
console.log('web/mvp.html', (html.length / 1024).toFixed(0), 'KB');
