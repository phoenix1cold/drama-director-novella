/**
 * Drama Director — Novella — Module entry point
 *
 * Boots the Visual Novel system and registers a sidebar button with the hub.
 */

import { initVNSystem, DDVNApi, DDVNPresets, DDVNMic, DDVNEmotionManager, isVNOpen } from './visual-novel.mjs';

const MODULE_ID = 'drama-director-novella';
const HUB_ID    = 'drama-director-hub';

function _ensureHub() {
  return game.modules.get(HUB_ID)?.api;
}

Hooks.once('init', () => {
  // Settings registration is handled inside DDVNPresets.register() during
  // initVNSystem(); see visual-novel.mjs.
  DDVNPresets.register();
  game.modules.get(MODULE_ID).api = DDVNApi;
  game.keybindings.register(MODULE_ID, 'emotionWheel', {
    name: 'DDNOVELLA.keys.emotionWheel', editable: [],
    onDown: () => { if (!isVNOpen()) return false; DDVNEmotionManager.showWheel(DDVNEmotionManager._lastMouseX || innerWidth / 2, DDVNEmotionManager._lastMouseY || innerHeight / 2); return true; },
  });
  game.keybindings.register(MODULE_ID, 'microphone', {
    name: 'DDNOVELLA.keys.microphone', editable: [],
    onDown: () => { if (!isVNOpen()) return false; DDVNMic._active ? DDVNMic.stop() : DDVNMic.start(); return true; },
  });
  console.log('[DD Novella] init');
});

Hooks.once('setup', () => {
  const hub = _ensureHub();
  if (!hub) {
    console.error('[DD Novella] hub not available; sidebar button will be missing');
    return;
  }
  hub.registerPanel({
    id: 'novella',
    moduleId: MODULE_ID,
    label: 'DDNOVELLA.hub.label',
    hint:  'DDNOVELLA.hub.hint',
    description: 'DDNOVELLA.hub.desc',
    icon: 'fa-solid fa-book-open',
    color: '#e86080',
    order: 50,
    open: () => DDVNApi.openPanel(),
  });
});

Hooks.once('ready', () => {
  try { initVNSystem(); }
  catch (e) { console.error('[DD Novella] initVNSystem failed', e); }
});
