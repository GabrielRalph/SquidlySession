/** Verify the actual viewer gesture handlers preserve native form defaults.
 * Run: node --experimental-vm-modules tests/manual_content_controls_smoke.mjs
 * DOM/media dependencies are stubbed; this does not claim browser visual coverage.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const context = vm.createContext({console});
const source = await fs.readFile(new URL('../src/Features/ShareContent/content-view.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(`${source}\nexport { ContentFrame };`, {context});
const names = ['delay','makeLogger','relURL','SvgPlus','Vector','GlobalWorkerOptions',
  'OccupiableWindow','AccessEvent','Icon','HideShowTransition','GridIcon',
  'CLICK_SLOP_NORM','buttonName','clientToNorm','wheelToLines','remoteControlStatusCopy'];
await module.link(() => new vm.SyntheticModule(names, function () {
  for (const name of names) this.setExport(name, name === 'GlobalWorkerOptions' ? {} : name === 'makeLogger' ? () => () => {} : class {});
}, {context}));
await module.evaluate();
const frame = Object.create(module.namespace.ContentFrame.prototype);
let resets = 0;
frame.transformable = true;
frame.resetTransform = () => resets++;
const root = {};
frame.addControlEvents(root);
function event(localControl) {
  const host = {closest:() => null};
  const actualTarget = {closest:() => localControl ? {} : null};
  return {target:host, composedPath:() => [actualTarget, host], defaultPrevented:false,
    preventDefault() { this.defaultPrevented = true; }};
}
for (const type of ['mousedown','mouseup','mousewheel','dblclick']) {
  const e = event(true);
  root.events[type](e);
  assert.equal(e.defaultPrevented, false, `${type} must preserve native control behavior`);
}
assert.equal(resets, 0, 'local double click must not reset shared content');
// A press on the selector must not arm a subsequent canvas drag.
root.events.mousedown(event(true));
root.events.mousemove({...event(false), buttons:1});
const canvasDown = event(false);
root.events.mousedown(canvasDown);
assert.equal(canvasDown.defaultPrevented, true, 'canvas panning must remain available');
root.events.mouseup(event(false));
root.events.dblclick(event(false));
assert.equal(resets, 1);
console.log('PASS real ContentFrame: selector/button defaults preserved, no accidental pan, canvas gestures retained');
