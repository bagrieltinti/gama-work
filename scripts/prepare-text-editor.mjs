import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const release = "0.18.1";
const archiveName = `wordcraft-web-${release}.zip`;
const releaseUrl = `https://github.com/storytold/wordcraft/releases/download/v${release}/${archiveName}`;
const archiveSha256 = "3daa7c2d1f209a7eeb2527fcefa3fe31e875848fb1970d68f54edae55fe0bc9f";
const sourceRoot = `wordcraft-web-${release}/`;
const output = join(root, "public", "tools", "text");
const wasmChunkSize = 16 * 1024 * 1024;

try {
  const preparedNote = await readFile(join(output, "licencas", "FONTE.md"), "utf8");
  if (preparedNote.includes(`storytold/wordcraft ${release}`) && await exists(join(output, "index.html")) && (await readdir(output)).some((name) => /^wasm-part-\d+\.bin$/.test(name))) process.exit(0);
} catch { /* download and prepare the pinned release */ }

let archive;
if (process.env.WORDCRAFT_ARCHIVE) {
  archive = await readFile(process.env.WORDCRAFT_ARCHIVE);
} else {
  const response = await fetch(releaseUrl, { headers: { "User-Agent": "Gama-Work-build" } });
  if (!response.ok) throw new Error(`Não foi possível obter o editor de texto (${response.status}).`);
  archive = Buffer.from(await response.arrayBuffer());
}
const checksum = createHash("sha256").update(archive).digest("hex");
if (checksum !== archiveSha256) throw new Error("A soma de verificação do pacote do editor não corresponde à versão aprovada.");

const zip = await JSZip.loadAsync(archive);
const wasmEntry = Object.values(zip.files).find((file) => file.name.startsWith(sourceRoot) && /_bg\.wasm$/.test(file.name));
const glueEntry = Object.values(zip.files).find((file) => file.name.startsWith(sourceRoot) && /^wordcraft-web-.*\.js$/.test(file.name.split("/").at(-1) ?? ""));
const indexEntry = zip.file(`${sourceRoot}index.html`);
if (!wasmEntry || !glueEntry || !indexEntry) throw new Error("O pacote do editor está incompleto.");

const wasm = await wasmEntry.async("nodebuffer");
const wasmParts = [];
for (let offset = 0; offset < wasm.byteLength; offset += wasmChunkSize) {
  wasmParts.push(wasm.subarray(offset, Math.min(offset + wasmChunkSize, wasm.byteLength)));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(join(output, "licencas"), { recursive: true });
const glueName = glueEntry.name.slice(sourceRoot.length);
let html = await indexEntry.async("string");
html = html
  .replace('<html lang="en">', '<html lang="pt-BR">')
  .replace(/<title>.*?<\/title>/, "<title>Gama Texto — Gama Work</title>")
  .replace(/\s*<link rel="icon"[^>]*>/, "")
  .replace(/<link rel="modulepreload"[^>]*>/g, "")
  .replace(/<link rel="preload"[^>]*\.wasm[^>]*>/, "")
  .replace(/const wasm = await init\(\{ module_or_path: '[^']+_bg\.wasm' \}\);/, `const wasmStream = new ReadableStream({ async start(controller) {
  try {
    for (const url of ${JSON.stringify(wasmParts.map((_, index) => `./wasm-part-${index}.bin`))}) {
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error('Não foi possível carregar uma parte do editor.');
      const reader = response.body.getReader();
      while (true) { const { done, value } = await reader.read(); if (done) break; controller.enqueue(value); }
    }
    controller.close();
  } catch (error) { controller.error(error); }
} });
const wasmResponse = new Response(wasmStream, { headers: { 'Content-Type': 'application/wasm' } });
const wasm = await init({ module_or_path: wasmResponse });`)
  .replace("Loading WordCraft&hellip;", "Preparando o editor de texto…");
if (html.includes("wordcraft-web-bc9cdbc0b42827ee_bg.wasm")) throw new Error("Não foi possível adaptar a carga do módulo WebAssembly.");

await writeFile(join(output, "index.html"), html);
await writeFile(join(output, glueName), await glueEntry.async("nodebuffer"));
for (const [index, part] of wasmParts.entries()) await writeFile(join(output, `wasm-part-${index}.bin`), part);

for (const file of Object.values(zip.files)) {
  if (!file.dir || !file.name.startsWith(sourceRoot)) continue;
  const relative = file.name.slice(sourceRoot.length);
  if (relative) await mkdir(join(output, relative), { recursive: true });
}
for (const file of Object.values(zip.files)) {
  if (file.dir || !file.name.startsWith(sourceRoot)) continue;
  const relative = file.name.slice(sourceRoot.length);
  if (!relative || relative === "index.html" || relative === wasmEntry.name.slice(sourceRoot.length) || relative === glueName) continue;
  if (relative.startsWith("snippets/")) await writeFile(join(output, relative), await file.async("nodebuffer"));
  else if (/^(LICENSE-|NOTICE$|ATTRIBUTION\.md$|OFL-.*\.txt$)/.test(relative)) await writeFile(join(output, `licencas/${relative}`), await file.async("nodebuffer"));
}
await writeFile(join(output, "licencas", "FONTE.md"), `Editor de texto para navegador incorporado ao Gama Work.\n\nVersão de origem: storytold/wordcraft ${release}. O pacote de origem e os avisos de licença estão preservados nesta pasta. O código WebAssembly foi dividido em partes de até 16 MiB para publicação como arquivos estáticos.\n`);
console.log(`Editor preparado: ${wasm.byteLength} bytes em ${wasmParts.length} partes estáticas.`);

async function exists(path) {
  try { await readFile(path); return true; } catch { return false; }
}
