import { installApp, listInstalledApps } from '../kernel/installedApps';

/**
 * Three apps that ship with the desktop, written only against the SDK.
 *
 * They exist to prove the platform rather than to be impressive: one asks for no permissions at
 * all, one uses the search service, and one holds file permissions in order to show you where they
 * stop. If the SDK were missing something these would be the first to show it, and they are the
 * reference anyone writing a fourth app would read.
 *
 * Each is a single file with its manifest in a leading comment — the same format anyone else's app
 * uses. Nothing about them is privileged; they install through the same path as a dropped file.
 */

const CALCULATOR = `/* tabula-app
{
  "id": "tabula.calculator",
  "name": "Calculator",
  "version": "1.0.1",
  "description": "A calculator that asks for no permissions at all",
  "author": "Tabula",
  "permissions": [],
  "defaultSize": { "width": 320, "height": 420 }
}
*/

// Nothing here needs the desktop's help, so this app was granted nothing and is never prompted.
// It is the honest floor of the platform: useful, sandboxed, and completely inert.

// The keypad is laid out to fit whatever window it is given rather than to a fixed height. It used
// to be a stack of fixed-size rows adding up to 24px more than the default window could show, so it
// opened with a scrollbar down the side — and any window shorter than the default scrolled too. A
// column that fills the height, with the grid taking whatever is left, has no size it can overflow.
document.body.style.cssText =
  'display:flex;flex-direction:column;height:100%;overflow:hidden;padding:12px;gap:10px';

var display = document.createElement('input');
display.readOnly = true;
display.value = '0';
display.style.cssText =
  'flex:0 0 auto;width:100%;font-size:28px;text-align:right;padding:10px 12px;font-family:ui-monospace,monospace';

var grid = document.createElement('div');
// minmax(0,1fr) rather than a plain 1fr: a grid row's automatic minimum is its own content, so 1fr
// rows refuse to shrink past the buttons inside them and the overflow comes straight back.
grid.style.cssText =
  'flex:1 1 auto;min-height:0;display:grid;grid-template-columns:repeat(4,1fr);' +
  'grid-template-rows:repeat(5,minmax(0,1fr));gap:8px';

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
  // No vertical padding: the row decides how tall a key is, so the keypad divides the space it
  // has rather than demanding a height of its own.
  button.style.cssText = 'padding:0;font-size:17px;min-height:0';
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

const FENCE = `/* tabula-app
{
  "id": "tabula.scratchpad",
  "name": "Fence",
  "version": "2.0.0",
  "description": "Holds real file permissions and still cannot leave its own folder",
  "author": "Tabula",
  "permissions": ["fs:read", "fs:write", "storage"],
  "defaultSize": { "width": 620, "height": 540 }
}
*/

// The id is still tabula.scratchpad although the app is now called Fence, and deliberately so: an
// id is an identity, a name is only a label. Changing the id would strand the permissions the user
// already granted and orphan the folder their files are in. Every app platform renames without
// re-identifying, and a reference app should show that rather than quietly get it wrong.
//
// What this demonstrates is the file scoping. fs:read and fs:write are both granted and both real,
// and they still reach nothing but Apps/Fence. The refusal leads the window because the refusal is
// the point; the notes underneath are only here to prove the permission does work in the direction
// it was actually granted.

var heading = document.createElement('p');
heading.textContent = 'This app holds fs:read and fs:write.';
heading.style.cssText = 'margin:0 0 4px;font-weight:600';

var sub = document.createElement('p');
sub.textContent =
  'Both are genuine. Neither reaches past Apps/Fence. Ask for something else and watch.';
sub.style.cssText = 'margin:0 0 12px;color:var(--muted);font-size:13px';

var probe = document.createElement('button');
probe.textContent = 'Try to read a file outside my folder';

var verdict = document.createElement('p');
verdict.style.cssText =
  'margin:10px 0 0;padding:10px;border:1px solid var(--muted);font-family:ui-monospace,monospace;font-size:12px';
verdict.textContent = 'Not asked yet.';

probe.addEventListener('click', function () {
  verdict.textContent = 'Asking the desktop for the root folder...';
  os.fs.readText('root').then(function () {
    verdict.textContent = 'UNEXPECTED - the sandbox allowed that. That would be a bug.';
  }, function (error) {
    verdict.textContent = 'Refused, as it should be - ' + String(error.message || error);
  });
});

var rule = document.createElement('hr');
rule.style.cssText = 'margin:18px 0;border:0;border-top:1px solid var(--muted)';

var allowed = document.createElement('p');
allowed.textContent = 'The same two permissions, pointed where they are allowed to go:';
allowed.style.cssText = 'margin:0 0 8px;color:var(--muted);font-size:13px';

document.body.append(heading, sub, probe, verdict, rule, allowed);

var list = document.createElement('select');
list.style.cssText = 'width:100%;margin-bottom:8px;padding:6px';

var area = document.createElement('textarea');
area.style.cssText =
  'width:100%;height:150px;padding:10px;font-family:ui-monospace,monospace;font-size:13px;resize:vertical';

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
    blank.textContent = files.length ? 'Open a note...' : 'No notes yet';
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
    // The host appends ' — Fence' to whatever is set here, so that a window cannot pass itself off
    // as a system one. That means the useful thing to set is the context, not the app's own name:
    // setTitle('Fence') would only ever render as 'Fence — Fence'.
    os.ui.setTitle(nameInput.value);
    status.textContent = 'Opened.';
  }, function (error) { status.textContent = String(error.message || error); });
});

saveButton.addEventListener('click', function () {
  var name = (nameInput.value || 'note.txt').trim();
  os.fs.writeText(name, area.value).then(function (file) {
    status.textContent = 'Saved ' + file.name + ' (' + file.size + ' bytes) into Apps/Fence';
    os.ui.setTitle(file.name);
    os.storage.set('lastFile', file.name);
    refresh();
  }, function (error) { status.textContent = String(error.message || error); });
});

os.storage.get('lastFile').then(function (last) {
  if (last) nameInput.value = last;
});

refresh();
`;

export const SAMPLE_APPS = [
  { source: CALCULATOR, id: 'tabula.calculator' },
  { source: FIND, id: 'tabula.find' },
  { source: FENCE, id: 'tabula.scratchpad' },
];

/**
 * Installs the bundled apps, and replaces any whose source has changed since it was last written.
 *
 * This used to install only what was missing, which meant an edit to a bundled app reached every
 * new desktop and no existing one. These three are the SDK's reference implementation, so a copy
 * that has silently fallen behind the source in this file is worse than no copy at all. Comparing
 * the stored source is enough to notice: `installApp` writes by id, so a changed app replaces
 * itself and keeps the permissions and the folder already attached to that id.
 */
export async function installSampleApps(): Promise<number> {
  const stored = new Map(listInstalledApps().map((app) => [app.id, app.source]));
  let installed = 0;

  for (const app of SAMPLE_APPS) {
    if (stored.get(app.id) === app.source) continue;
    try {
      await installApp(app.source, 'bundled');
      installed++;
    } catch {
      // A malformed bundled app is a bug, but it must not stop the desktop from starting.
    }
  }
  return installed;
}
