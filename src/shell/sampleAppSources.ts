/**
 * Three apps that ship with the desktop, written only against the SDK.
 *
 * Kept apart from the code that installs them, as plain strings with no imports, so they can be
 * read, diffed and tested without starting the desktop.
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
  "version": "2.0.0",
  "description": "A calculator that asks for no permissions at all",
  "author": "Tabula",
  "permissions": [],
  "resizable": false,
  "defaultSize": { "width": 322, "height": 500 },
  "skinSizes": { "classic": { "width": 262, "height": 224 } }
}
*/

// Nothing here needs the desktop's help, so this app was granted nothing and is never prompted.
// It is the honest floor of the platform: useful, sandboxed, and completely inert.
//
// Two calculators over one engine. Under classic it is the 1990s standard calculator: a small grey
// window, memory keys down the left, Backspace / CE / C along the top, digits in blue and
// operators in red. Under modern it is the current one: a large display over a column of small
// rounded keys, with = in the accent. The window is a fixed size in both, as the originals were,
// and the layout follows the document's data-skin attribute when the user switches.

/* -- The engine ------------------------------------------------------------------------------ */

var current = '0';      // what the display shows, as typed
var previous = null;    // the left operand, once an operator has been chosen
var operator = null;    // '+', '-', '×' or '÷'
var fresh = true;       // the next digit starts a new number
var memory = 0;
var hasMemory = false;
var expression = '';    // the modern skin's line above the display
var error = null;

function format(value) {
  if (!isFinite(value)) return null;
  // Fifteen significant digits hides binary rounding (0.1 + 0.2) without hiding real precision.
  var text = String(Number(value.toPrecision(15)));
  return text.length > 16 ? value.toExponential(9) : text;
}

function number() {
  return Number(current);
}

function setResult(value) {
  var text = format(value);
  if (text === null) {
    error = value === Infinity || value === -Infinity ? 'Cannot divide by zero' : 'Invalid input';
    current = '0'; previous = null; operator = null; expression = '';
  } else {
    current = text;
  }
  fresh = true;
}

function apply(a, b, op) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '×') return a * b;
  if (op === '÷') return b === 0 ? Infinity : a / b;
  return b;
}

function press(key) {
  error = null;
  if (key >= '0' && key <= '9') {
    current = fresh || current === '0' ? key : current.length < 16 ? current + key : current;
    fresh = false;
  } else if (key === '.') {
    if (fresh) { current = '0.'; fresh = false; }
    else if (current.indexOf('.') === -1) current += '.';
  } else if (key === 'back') {
    if (!fresh) current = current.length > 1 ? current.slice(0, -1) : '0';
    if (current === '-') current = '0';
  } else if (key === 'CE') {
    current = '0'; fresh = true;
  } else if (key === 'C') {
    current = '0'; previous = null; operator = null; fresh = true; expression = '';
  } else if (key === '±') {
    if (current !== '0') current = current.charAt(0) === '-' ? current.slice(1) : '-' + current;
  } else if (key === '%') {
    setResult(previous === null ? number() / 100 : (previous * number()) / 100);
  } else if (key === '1/x') {
    setResult(number() === 0 ? Infinity : 1 / number());
  } else if (key === 'sqrt') {
    setResult(number() < 0 ? NaN : Math.sqrt(number()));
  } else if (key === 'sqr') {
    setResult(number() * number());
  } else if (key === '=') {
    if (operator !== null && previous !== null) {
      var right = number();
      expression = format(previous) + ' ' + operator + ' ' + format(right) + ' =';
      setResult(apply(previous, right, operator));
      previous = null; operator = null;
    }
  } else if (key === 'MC') { memory = 0; hasMemory = false; }
  else if (key === 'MR') { if (hasMemory) { current = format(memory); fresh = true; } }
  else if (key === 'MS') { memory = number(); hasMemory = true; fresh = true; }
  else if (key === 'M+') { memory += number(); hasMemory = true; fresh = true; }
  else if (key === 'M-') { memory -= number(); hasMemory = true; fresh = true; }
  else {
    // An operator. Chaining one after another computes as it goes, as both calculators do.
    if (operator !== null && previous !== null && !fresh) {
      setResult(apply(previous, number(), operator));
    }
    if (error === null) {
      previous = number();
      operator = key;
      expression = format(previous) + ' ' + key;
      fresh = true;
    }
  }
  render();
}

/* -- The two faces ----------------------------------------------------------------------------- */

var display = null;
var expressionLine = null;
var memoryMark = null;
var memoryKeys = [];

function classic() {
  return document.documentElement.dataset.skin === 'classic';
}

function render() {
  if (!display) return;
  if (error !== null) {
    display.textContent = error;
  } else if (classic()) {
    // The era's calculator always showed the decimal point: "0." rather than "0".
    display.textContent = current.indexOf('.') === -1 && current.indexOf('e') === -1 ? current + '.' : current;
  } else {
    display.textContent = grouped(current);
    display.style.fontSize = display.textContent.length > 12 ? '30px' : '44px';
  }
  if (expressionLine) expressionLine.textContent = expression;
  if (memoryMark) memoryMark.textContent = hasMemory ? 'M' : '';
  memoryKeys.forEach(function (button) { button.disabled = !hasMemory; });
}

// Thousands separators on the whole part only, so a number being typed — "1.50", "12." — shows
// exactly what was typed after the point.
function grouped(text) {
  if (text.indexOf('e') !== -1) return text;
  var negative = text.charAt(0) === '-';
  var parts = (negative ? text.slice(1) : text).split('.');
  var whole = Number(parts[0]).toLocaleString('en-US');
  return (negative ? '-' : '') + whole + (parts.length > 1 ? '.' + parts[1] : '');
}

var NAMES = {
  back: 'Backspace', '1/x': 'Reciprocal', sqr: 'Square', sqrt: 'Square root', '±': 'Positive negative',
  '-': 'Minus', '+': 'Plus', '×': 'Multiply by', '÷': 'Divide by', '=': 'Equals', '%': 'Percent',
  CE: 'Clear entry', C: 'Clear', MC: 'Memory clear', MR: 'Memory recall', MS: 'Memory store',
  'M+': 'Memory add', 'M-': 'Memory subtract', '.': 'Decimal separator',
};

function key(label, value, style) {
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', NAMES[value] || label);
  button.style.cssText = style || '';
  button.addEventListener('click', function () { press(value); });
  return button;
}

function buildClassic() {
  memoryKeys = [];
  document.body.style.cssText =
    'padding:6px 8px 8px;overflow:hidden;font-size:11px;background:#c0c0c0';

  display = document.createElement('div');
  display.setAttribute('role', 'status');
  display.style.cssText =
    'height:24px;line-height:22px;padding:0 4px;text-align:right;background:#ffffff;' +
    'border:1px solid #000;box-shadow:inset 1px 1px 0 #808080, inset -1px -1px 0 #fff;' +
    'font-size:13px;overflow:hidden;white-space:nowrap';

  var top = document.createElement('div');
  top.style.cssText = 'display:flex;gap:6px;margin:8px 0 6px';
  memoryMark = document.createElement('div');
  memoryMark.style.cssText =
    'flex:0 0 34px;height:26px;line-height:24px;text-align:center;' +
    'box-shadow:inset 1px 1px 0 #808080, inset -1px -1px 0 #fff;font-size:11px';
  var red = 'color:#ff0000;';
  var wide = 'flex:1 1 0;height:26px;padding:0;font-size:11px;';
  top.append(memoryMark, key('Backspace', 'back', wide + red), key('CE', 'CE', wide + red), key('C', 'C', wide + red));

  var grid = document.createElement('div');
  grid.style.cssText =
    'display:grid;grid-template-columns:34px 4px repeat(5,1fr);grid-auto-rows:26px;gap:5px 4px';
  var blue = 'color:#0000ff;';
  var cell = 'padding:0;font-size:11px;min-width:0;';
  var rows = [
    ['MC', '7', '8', '9', '÷', 'sqrt'],
    ['MR', '4', '5', '6', '×', '%'],
    ['MS', '1', '2', '3', '-', '1/x'],
    ['M+', '0', '±', '.', '+', '='],
  ];
  var labels = { '÷': '/', '×': '*', '±': '+/-' };
  rows.forEach(function (row) {
    row.forEach(function (value, index) {
      var memoryKey = index === 0;
      var operatorKey = '÷×-+='.indexOf(value) !== -1;
      var colour = memoryKey || operatorKey ? red : blue;
      var button = key(labels[value] || value, value, cell + colour);
      if (memoryKey) {
        // Always live, as they were: the box above them is what says whether anything is stored.
        grid.append(button, document.createElement('span'));
      } else {
        grid.append(button);
      }
    });
  });

  document.body.append(display, top, grid);
}

function buildModern() {
  memoryMark = null;
  memoryKeys = [];
  document.body.style.cssText =
    'padding:4px 6px 6px;overflow:hidden;display:flex;flex-direction:column;background:#f3f3f3';

  var title = document.createElement('div');
  title.textContent = 'Standard';
  title.style.cssText = 'font-size:20px;font-weight:600;padding:4px 6px 0';

  expressionLine = document.createElement('div');
  expressionLine.style.cssText =
    'min-height:20px;margin-top:6px;padding:0 8px;text-align:right;color:#616161;font-size:14px;' +
    'overflow:hidden;white-space:nowrap';

  display = document.createElement('div');
  display.setAttribute('role', 'status');
  display.style.cssText =
    'height:64px;line-height:64px;padding:0 8px;text-align:right;font-size:44px;font-weight:600;' +
    'overflow:hidden;white-space:nowrap';

  var memoryRow = document.createElement('div');
  memoryRow.style.cssText = 'display:flex;margin:2px 0 4px';
  var flat = 'flex:1;height:32px;padding:0;border:0;border-radius:4px;background:transparent;font-size:12px;font-weight:600;';
  ['MC', 'MR', 'M+', 'M-', 'MS'].forEach(function (value) {
    var button = key(value, value, flat);
    if (value === 'MC' || value === 'MR') memoryKeys.push(button);
    memoryRow.append(button);
  });

  var grid = document.createElement('div');
  grid.style.cssText =
    'flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(6,1fr);gap:2px';
  var base = 'padding:0;min-width:0;border:1px solid rgb(0 0 0 / 6%);border-radius:4px;font-size:14px;';
  var digit = base + 'background:#ffffff;font-size:16px;font-weight:600;';
  var fn = base + 'background:#f9f9f9;';
  var equals = base + 'background:var(--accent);color:#ffffff;border-color:transparent;font-size:18px;';
  var layout = [
    ['%', '%'], ['CE', 'CE'], ['C', 'C'], ['⌫', 'back'],
    ['¹⁄ₓ', '1/x'], ['x²', 'sqr'], ['²√x', 'sqrt'], ['÷', '÷'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['×', '×'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'],
    ['+/−', '±'], ['0', '0'], ['.', '.'], ['=', '='],
  ];
  layout.forEach(function (pair) {
    var value = pair[1];
    var style = value === '=' ? equals : (value >= '0' && value <= '9') || value === '.' || value === '±' ? digit : fn;
    grid.append(key(pair[0], value, style));
  });

  document.body.append(title, expressionLine, display, memoryRow, grid);
}

function build() {
  document.body.textContent = '';
  expressionLine = null;
  if (classic()) buildClassic();
  else buildModern();
  render();
}

build();

// The skin can change while the window is open; the same sum carries over to the other face.
new MutationObserver(build).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-skin'],
});

document.addEventListener('keydown', function (event) {
  var value = event.key;
  var map = {
    Enter: '=', Escape: 'C', Backspace: 'back', Delete: 'CE', '*': '×', '/': '÷', x: '×', ',': '.',
  };
  if (map[value]) value = map[value];
  if ('0123456789.+-×÷=%'.indexOf(value) !== -1 || value === 'back' || value === 'CE' || value === 'C') {
    press(value);
    event.preventDefault();
  }
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
