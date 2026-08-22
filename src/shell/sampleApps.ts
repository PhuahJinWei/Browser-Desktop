import { installApp, listInstalledApps } from '../kernel/installedApps';

/**
 * Three apps that ship with the desktop, written only against the SDK.
 *
 * They exist to prove the platform rather than to be impressive: one asks for no permissions at
 * all, one uses the search service, and one writes files into its own folder. If the SDK were
 * missing something these would be the first to show it, and they are the reference anyone writing
 * a fourth app would read.
 *
 * Each is a single file with its manifest in a leading comment — the same format anyone else's app
 * uses. Nothing about them is privileged; they install through the same path as a dropped file.
 */

const CALCULATOR = `/* tabula-app
{
  "id": "tabula.calculator",
  "name": "Calculator",
  "version": "1.0.0",
  "description": "A calculator that asks for no permissions at all",
  "author": "Tabula",
  "permissions": [],
  "defaultSize": { "width": 320, "height": 420 }
}
*/

// Nothing here needs the desktop's help, so this app was granted nothing and is never prompted.
// It is the honest floor of the platform: useful, sandboxed, and completely inert.

var display = document.createElement('input');
display.readOnly = true;
display.value = '0';
display.style.cssText =
  'width:100%;font-size:28px;text-align:right;padding:12px;margin-bottom:12px;font-family:ui-monospace,monospace';

var grid = document.createElement('div');
grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:8px';

var current = '0';
var previous = null;
var operator = null;
var fresh = true;

function show(value) {
  var text = String(value);
  display.value = text.length > 14 ? Number(value).toPrecision(9) : text;
}

function apply() {
  if (operator === null || previous === null) return Number(current);
  var a = previous;
  var b = Number(current);
  if (operator === '+') return a + b;
  if (operator === '-') return a - b;
  if (operator === '×') return a * b;
  if (operator === '÷') return b === 0 ? NaN : a / b;
  return b;
}

function press(key) {
  if (key >= '0' && key <= '9') {
    current = fresh || current === '0' ? key : current + key;
    fresh = false;
  } else if (key === '.') {
    if (fresh) { current = '0.'; fresh = false; }
    else if (current.indexOf('.') === -1) current += '.';
  } else if (key === 'C') {
    current = '0'; previous = null; operator = null; fresh = true;
  } else if (key === '±') {
    current = String(-Number(current));
  } else if (key === '%') {
    current = String(Number(current) / 100);
  } else if (key === '=') {
    var result = apply();
    current = Number.isFinite(result) ? String(result) : 'Error';
    previous = null; operator = null; fresh = true;
  } else {
    if (operator !== null && !fresh) { current = String(apply()); }
    previous = Number(current);
    operator = key;
    fresh = true;
  }
  show(current);
}

var keys = ['C','±','%','÷','7','8','9','×','4','5','6','-','1','2','3','+','0','.','='];
keys.forEach(function (key) {
  var button = document.createElement('button');
  button.textContent = key;
  button.style.cssText = 'padding:14px 0;font-size:17px';
  if (key === '0') button.style.gridColumn = 'span 2';
  if (key === '=') { button.style.background = 'var(--accent)'; button.style.color = 'var(--bg)'; }
  button.addEventListener('click', function () { press(key); });
  grid.appendChild(button);
});

document.body.append(display, grid);

document.addEventListener('keydown', function (event) {
  var key = event.key;
  if (key === 'Enter') key = '=';
  if (key === 'Escape') key = 'C';
  if (key === '*') key = '×';
  if (key === '/') key = '÷';
  if (keys.indexOf(key) !== -1) { press(key); event.preventDefault(); }
});
`;

const FIND = `/* tabula-app
{
  "id": "tabula.find",
  "name": "Find",
  "version": "1.0.0",
  "description": "Searches your indexed files and groups the answers by document",
  "author": "Tabula",
  "permissions": ["ai:search", "clipboard", "notifications"],
  "defaultSize": { "width": 620, "height": 520 }
}
*/

// Uses the desktop's search service through the SDK. The app never sees a file system, a model or
// an index — it asks a question and gets passages back, and the desktop decides whether it may.

var input = document.createElement('input');
input.type = 'search';
input.placeholder = 'Ask a question…';
input.style.cssText = 'width:100%;font-size:16px;padding:10px;margin-bottom:12px';

var status = document.createElement('p');
status.style.cssText = 'color:var(--muted);font-size:13px;margin:0 0 12px';
status.textContent = 'Grouped by document, best passage first.';

var results = document.createElement('div');
document.body.append(input, status, results);

var timer = null;
input.addEventListener('input', function () {
  clearTimeout(timer);
  timer = setTimeout(run, 260);
});

function run() {
  var query = input.value.trim();
  results.textContent = '';
  if (!query) { status.textContent = 'Grouped by document, best passage first.'; return; }

  status.textContent = 'Searching…';
  os.ai.search(query, 25).then(function (hits) {
    if (hits.length === 0) { status.textContent = 'Nothing matched.'; return; }

    // Grouping is the app's own idea; the desktop returns a flat ranked list.
    var byFile = new Map();
    hits.forEach(function (hit) {
      if (!byFile.has(hit.fileName)) byFile.set(hit.fileName, []);
      byFile.get(hit.fileName).push(hit);
    });

    status.textContent = hits.length + ' passages across ' + byFile.size + ' documents';

    byFile.forEach(function (group, name) {
      var section = document.createElement('section');
      section.style.cssText = 'margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--line)';

      var heading = document.createElement('h3');
      heading.textContent = name;
      heading.style.cssText = 'margin:0 0 6px;font-size:14px';
      section.appendChild(heading);

      group.slice(0, 3).forEach(function (hit) {
        var passage = document.createElement('p');
        passage.textContent = hit.snippet;
        passage.style.cssText = 'margin:0 0 6px;font-size:13px;color:var(--muted);line-height:1.5';
        section.appendChild(passage);
      });

      var copy = document.createElement('button');
      copy.textContent = 'Copy passages';
      copy.style.fontSize = '12px';
      copy.addEventListener('click', function () {
        var text = name + '\\n\\n' + group.map(function (hit) { return hit.snippet; }).join('\\n\\n');
        os.clipboard.writeText(text).then(function () {
          os.ui.notify('Copied', name);
        }, function (error) {
          status.textContent = String(error.message || error);
        });
      });
      section.appendChild(copy);
      results.appendChild(section);
    });
  }, function (error) {
    // A denied permission arrives here as a rejected promise, and saying so is better than
    // silently showing nothing.
    status.textContent = String(error.message || error);
  });
}

os.ui.setTitle('Find');
`;

const SCRATCHPAD = `/* tabula-app
{
  "id": "tabula.scratchpad",
  "name": "Scratchpad",
  "version": "1.0.0",
  "description": "Jots notes into its own folder — and cannot see anything else",
  "author": "Tabula",
  "permissions": ["fs:read", "fs:write", "storage"],
  "defaultSize": { "width": 620, "height": 480 }
}
*/

// Demonstrates the file scoping. This app has fs:read and fs:write, and can still only reach
// Apps/Scratchpad — try the button at the bottom, which asks for a file it has no business seeing.

var list = document.createElement('select');
list.style.cssText = 'width:100%;margin-bottom:8px;padding:6px';

var area = document.createElement('textarea');
area.style.cssText =
  'width:100%;height:260px;padding:10px;font-family:ui-monospace,monospace;font-size:13px;resize:vertical';

var row = document.createElement('div');
row.style.cssText = 'display:flex;gap:8px;margin:10px 0';

var nameInput = document.createElement('input');
nameInput.placeholder = 'note.txt';
nameInput.style.flex = '1';

var saveButton = document.createElement('button');
saveButton.textContent = 'Save';

var status = document.createElement('p');
status.style.cssText = 'color:var(--muted);font-size:12px;min-height:18px';

row.append(nameInput, saveButton);
document.body.append(list, area, row, status);

function refresh() {
  os.fs.list().then(function (files) {
    list.textContent = '';
    var blank = document.createElement('option');
    blank.textContent = files.length ? 'Open a note…' : 'No notes yet';
    blank.value = '';
    list.appendChild(blank);
    files.forEach(function (file) {
      var option = document.createElement('option');
      option.value = file.id;
      option.textContent = file.name;
      list.appendChild(option);
    });
  }, function (error) { status.textContent = String(error.message || error); });
}

list.addEventListener('change', function () {
  if (!list.value) return;
  os.fs.readText(list.value).then(function (text) {
    area.value = text;
    nameInput.value = list.options[list.selectedIndex].textContent;
    status.textContent = 'Opened.';
  }, function (error) { status.textContent = String(error.message || error); });
});

saveButton.addEventListener('click', function () {
  var name = (nameInput.value || 'note.txt').trim();
  os.fs.writeText(name, area.value).then(function (file) {
    status.textContent = 'Saved ' + file.name + ' (' + file.size + ' bytes) into Apps/Scratchpad';
    os.storage.set('lastFile', file.name);
    refresh();
  }, function (error) { status.textContent = String(error.message || error); });
});

// The point of the demonstration: ask for something outside the app's folder and be refused.
var probe = document.createElement('button');
probe.textContent = 'Try to read a file outside my folder';
probe.style.cssText = 'margin-top:12px;font-size:12px';
probe.addEventListener('click', function () {
  os.fs.readText('root').then(function () {
    status.textContent = 'Unexpected: the sandbox let that through.';
  }, function (error) {
    status.textContent = 'Refused, as it should be — ' + String(error.message || error);
  });
});
document.body.appendChild(probe);

os.storage.get('lastFile').then(function (last) {
  if (last) nameInput.value = last;
});

refresh();
os.ui.setTitle('Scratchpad');
`;

export const SAMPLE_APPS = [
  { source: CALCULATOR, id: 'tabula.calculator' },
  { source: FIND, id: 'tabula.find' },
  { source: SCRATCHPAD, id: 'tabula.scratchpad' },
];

/** Installs the bundled apps once, on first boot. */
export async function installSampleApps(): Promise<number> {
  const existing = new Set(listInstalledApps().map((app) => app.id));
  let installed = 0;

  for (const app of SAMPLE_APPS) {
    if (existing.has(app.id)) continue;
    try {
      await installApp(app.source, 'bundled');
      installed++;
    } catch {
      // A malformed bundled app is a bug, but it must not stop the desktop from starting.
    }
  }
  return installed;
}
