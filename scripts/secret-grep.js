// Fails where a secret's value is anywhere under a folder, in any form the
// redactor hides: as typed, JSON-escaped, or percent-encoded. The fixture runs
// it over its copy's .harness/ after the agent's tests, with the values its
// harness config makes up, so a trace, a tree, a cache entry or the AI trace
// that kept one fails the run. It names the file and the secret, never the value.
//
//   node scripts/secret-grep.js <folder> <value>...
import fs from 'node:fs';
import path from 'node:path';

const [folder, ...values] = process.argv.slice(2);
if (!folder || values.length === 0) {
  console.error('usage: node scripts/secret-grep.js <folder> <value>...');
  process.exit(2);
}

const found = [];
for (const entry of fs.readdirSync(folder, {recursive: true, withFileTypes: true})) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  // As bytes, so a value is found in any file, a picture's metadata among them.
  const text = fs.readFileSync(file).toString('latin1');
  values.forEach((value, index) => {
    const forms = [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)];
    if (forms.some(form => text.includes(form))) found.push(`${path.relative(folder, file)} holds secret ${index + 1}`);
  });
}

if (found.length > 0) {
  console.error(`a secret's value was kept under ${folder}:\n${found.map(line => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log(`no secret's value under ${folder}, in ${values.length} secret${values.length === 1 ? '' : 's'}' forms`);
