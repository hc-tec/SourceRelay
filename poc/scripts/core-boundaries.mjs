import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.ts', '.mjs', '.py']);

const RULES = [
  {
    directory: 'collector-contracts/src',
    forbidden: /collector-gateway|collector-browser-host|collector-extension|playwright|chrome|knowledge_pack|intelligence_knowledge_pack/i
  },
  {
    directory: 'collector-client/src',
    forbidden: /collector-gateway|collector-browser-host|collector-extension|playwright|chrome|knowledge_pack|deepresearch/i
  },
  {
    directory: 'collector-python-client/src',
    forbidden: /intelligence_knowledge_pack|knowledge_pack|playwright|selenium|chrome|deepresearch/i
  },
  {
    directory: 'collector-extension/src',
    forbidden: /collector-gateway|collector-browser-host|knowledge_pack|deepresearch/i
  },
  {
    directory: 'collector-browser-host/src',
    forbidden: /knowledge_pack|intelligence_knowledge_pack|deepresearch/i
  },
  {
    directory: 'collector-gateway/src',
    forbidden: /knowledge_pack|intelligence_knowledge_pack|deepresearch/i
  }
];

export async function findCoreBoundaryViolations(pocRoot = defaultPocRoot()) {
  const violations = [];
  for (const rule of RULES) {
    const directory = resolve(pocRoot, rule.directory);
    for (const file of await sourceFiles(directory)) {
      const text = await readFile(file, 'utf8');
      for (const specifier of importSpecifiers(text, extname(file))) {
        if (rule.forbidden.test(specifier)) {
          violations.push({
            file: relative(pocRoot, file).replaceAll('\\', '/'),
            specifier,
            rule: rule.directory
          });
        }
      }
    }
  }
  return violations;
}

export async function assertCoreBoundaries(pocRoot = defaultPocRoot()) {
  const violations = await findCoreBoundaryViolations(pocRoot);
  if (violations.length > 0) {
    const details = violations.map((violation) =>
      `${violation.file}: forbidden import ${violation.specifier} (${violation.rule})`
    ).join('\n');
    throw new Error(`collector_core_boundary_violation\n${details}`);
  }
}

async function sourceFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'runtime') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function importSpecifiers(text, extension) {
  const values = [];
  if (extension === '.py') {
    const pythonImport = /^\s*(?:from|import)\s+([^\s;#]+)/gm;
    for (const match of text.matchAll(pythonImport)) values.push(match[1]);
    return values;
  }
  const moduleImport = /\b(?:from|import)\s*[\s\S]*?['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(moduleImport)) values.push(match[1]);
  return values;
}

function defaultPocRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

