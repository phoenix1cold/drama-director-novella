/**
 * Drama Director — Visual Novel Mode
 * Updated: Added mouse control, depth mode, player control
 */

// Inline replacement for the legacy `getLanguagePromise()` import. The hub
// module performs the actual i18n override; novella simply waits a tick so
// fetched language data has a chance to merge in before first render.
function getLanguagePromise() {
  return Promise.resolve();
}

import { VN3D, scene3D, model3D, mount3DEditor } from './vn-3d.mjs';
import { Whisper, LocalSpeech, mountSTTSettings } from './vn-whisper.mjs';
import { MotionQueue } from './vn-motion.mjs';
import { charactersFromMap } from './vn-map-characters.mjs';
import { SceneEditor } from './vn-scene-editor.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = 'drama-director-novella';
const SOCKET    = `module.${MODULE_ID}`;

/** Animate a VN element in/out.
 *  animType: e.g. 'fade','slideUp','blur' — matches vn-anim-* keyframes.
 *  dir: 'in' | 'out'. onDone called after 'out' finishes. */
function _animateElem(el, animType, dir, onDone) {
  el._vnAnimation?.cancel();
  el.classList.remove('vn-elem-anim-in', 'vn-elem-anim-out');
  el.style.animationName = '';
  if (!animType || animType === 'none' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !el.animate) {
    onDone?.(); return;
  }
  const base = { transform: el.style.transform || 'none', opacity: getComputedStyle(el).opacity, filter: el.style.filter || 'none', clipPath: 'inset(0 0 0 0)' };
  const delta = {
    zoomIn: dir === 'in' ? 'scale(.7)' : 'scale(1.3)', zoomOut: dir === 'in' ? 'scale(1.3)' : 'scale(.7)',
    slideUp: `translateY(${dir === 'in' ? 80 : -80}px)`, slideDown: `translateY(${dir === 'in' ? -80 : 80}px)`,
    slideLeft: 'translateX(-120px)', slideRight: 'translateX(120px)',
    rise: 'translateY(40px) scale(.94)', drop: 'translateY(-40px) scale(.94)',
    spin: 'scale(.4) rotate(-180deg)', flip: 'perspective(800px) rotateX(75deg)', flipY: 'perspective(800px) rotateY(75deg)', blur: 'scale(1.04)',
  }[animType] || '';
  const hidden = { ...base, opacity: 0, transform: `${base.transform === 'none' ? '' : base.transform} ${delta}`.trim() || 'none' };
  if (animType === 'blur') hidden.filter = 'blur(20px)';
  if (animType === 'swipeLeft') hidden.clipPath = 'inset(0 100% 0 0)';
  if (animType === 'swipeRight') hidden.clipPath = 'inset(0 0 0 100%)';
  const animation = el.animate(dir === 'in' ? [hidden, base] : [base, hidden], {
    duration: dir === 'in' ? 450 : 320, easing: 'ease-out', fill: 'both',
  });
  el._vnAnimation = animation;
  animation.finished.then(() => {
    if (el._vnAnimation !== animation) return;
    onDone?.(); animation.cancel(); el._vnAnimation = null;
  }).catch(() => {});
}

/** Execute only with the current user's own Foundry permissions. */
function _execMacro(macroId) {
  if (!macroId) return;
  const macro = game.macros?.get(macroId) ?? game.macros?.getName(macroId);
  if (!macro || !macro.canExecute) {
    ui.notifications?.warn(game.i18n.localize('DDNOVELLA.macroDenied'));
    return;
  }
  Promise.resolve(macro.execute()).catch(e => ui.notifications?.error(e.message));
}

function deepClone(o) { return foundry.utils.deepClone(o); }
function uid() { return Math.random().toString(36).slice(2, 9); }

// ─── Встроенные фоны ─────────────────────────────────────────────────────────
const _BUILTIN_BG_DEFS = [
  // ── Город ────────────────────────────────────────────────────────────────
  {
    id: 'city', _nameKey: 'DRAMADIRECTOR.vn.bg.city',
    variants: [
      { id: 'citybank-day',   _nameKey: 'DRAMADIRECTOR.vn.bg.citybankDay',   src: 'modules/drama-director-novella/assets/vn-assets/CityBank.mp4' },
      { id: 'citybank-night', _nameKey: 'DRAMADIRECTOR.vn.bg.citybankNight', src: 'modules/drama-director-novella/assets/vn-assets/CityBankNight.mp4' },
      { id: 'church',         _nameKey: 'DRAMADIRECTOR.vn.bg.church',         src: 'modules/drama-director-novella/assets/vn-assets/GrandChurchInterior.mp4' },
      { id: 'emptytavern',    _nameKey: 'DRAMADIRECTOR.vn.bg.emptytavern',    src: 'modules/drama-director-novella/assets/vn-assets/EmptyTavern.mp4' },
      { id: 'tradetents',     _nameKey: 'DRAMADIRECTOR.vn.bg.tradetents',     src: 'modules/drama-director-novella/assets/vn-assets/TradeTents.mp4' },
      { id: 'alchemy',        _nameKey: 'DRAMADIRECTOR.vn.bg.alchemy',        src: 'modules/drama-director-novella/assets/vn-assets/Alchemy.mp4' },
    ],
  },
  // ── Лес ──────────────────────────────────────────────────────────────────
  {
    id: 'forest', _nameKey: 'DRAMADIRECTOR.vn.bg.forest',
    variants: [
      { id: 'forest-day',   _nameKey: 'DRAMADIRECTOR.vn.bg.forestDay',   src: 'modules/drama-director-novella/assets/vn-assets/Fungal-Forest.mp4' },
      { id: 'forest-night', _nameKey: 'DRAMADIRECTOR.vn.bg.forestNight', src: 'modules/drama-director-novella/assets/vn-assets/Fungal-Forest-Night.mp4' },
    ],
  },
  // ── Болото ────────────────────────────────────────────────────────────────
  {
    id: 'swamp', _nameKey: 'DRAMADIRECTOR.vn.bg.swamp',
    variants: [
      { id: 'woodenbridgeinswamp', _nameKey: 'DRAMADIRECTOR.vn.bg.woodenbridgeinswamp', src: 'modules/drama-director-novella/assets/vn-assets/WoodenBridgeInSwamp.mp4' },
    ],
  },
  // ── Подземелья ───────────────────────────────────────────────────────────
  {
    id: 'dungeon', _nameKey: 'DRAMADIRECTOR.vn.bg.dungeon',
    variants: [
      { id: 'sewer',   _nameKey: 'DRAMADIRECTOR.vn.bg.sewer',   src: 'modules/drama-director-novella/assets/vn-assets/Sewer_Lair.mp4' },
      { id: 'oldmine', _nameKey: 'DRAMADIRECTOR.vn.bg.oldmine', src: 'modules/drama-director-novella/assets/vn-assets/OldMine.mp4' },
    ],
  },
  // ── Заброшки ─────────────────────────────────────────────────────────────
  {
    id: 'abandoned', _nameKey: 'DRAMADIRECTOR.vn.bg.abandoned',
    variants: [
      { id: 'sawmill-day',      _nameKey: 'DRAMADIRECTOR.vn.bg.sawmillDay',      src: 'modules/drama-director-novella/assets/vn-assets/Sawmill.mp4' },
      { id: 'sawmill-night',    _nameKey: 'DRAMADIRECTOR.vn.bg.sawmillNight',    src: 'modules/drama-director-novella/assets/vn-assets/Sawmill_Night.mp4' },
      { id: 'abbaddonedchurch', _nameKey: 'DRAMADIRECTOR.vn.bg.abbaddonedchurch', src: 'modules/drama-director-novella/assets/vn-assets/AbbadonedChurch.mp4' },
      { id: 'abbaddonedtemple', _nameKey: 'DRAMADIRECTOR.vn.bg.abbaddonedtemple', src: 'modules/drama-director-novella/assets/vn-assets/AbaddonedTemple.mp4' },
    ],
  },
];

function _resolveBgNames(defs) {
  return defs.map(bg => ({
    ...bg,
    name: game.i18n.localize(bg._nameKey),
    _builtin: true,
    variants: bg.variants.map(v => ({ ...v, name: game.i18n.localize(v._nameKey) })),
  }));
}

export const VN_BUILTIN_BACKGROUNDS = _BUILTIN_BG_DEFS;

export function newChar(side = 'left', slot = 0) {
  return { id: uid(), name: '', title: '', img: '', activeImg: '', side, slot,
    playerId: null, active: false, visible: true, locked: false,
    scale: 1.0, baseScale: 1.0, mirror: false, nameColor: '#ffe066',
    x: 0, y: 0, zIndex: 0, _pinned: false, _pinnedWidth: 0,
    emotions: [], activeEmotion: '', _baseImg: '', tags: [],
    macroId: '', triggerOnClick: true, triggerOnHover: false, hoverSrc: '',
    animIn: 'fade', animOut: 'fade' };
}

export function newLayer(type = 'image') {
  return { id: uid(), type, name: '',
    src: '', text: '', locked: false,
    x: 760, y: 400, zIndex: 0,
    width: 400, height: 300, scale: 1, baseScale: 1.0,
    fontSize: 28, color: '#ffffff', fontFamily: 'inherit',
    textAlign: 'center', opacity: 1, visible: true, tags: [],
    animIn: 'fade', animOut: 'fade' };
}

export function newInteractiveImage() {
  return { id: uid(), name: '', src: '', hoverSrc: '', locked: false,
    x: 900, y: 500, zIndex: 0,
    width: 200, height: 200, scale: 1, baseScale: 1.0, macroId: '',
    opacity: 1, visible: true, triggerOnHover: false, triggerOnClick: true, tags: [],
    animIn: 'fade', animOut: 'fade' };
}

// ─── Состояние ───────────────────────────────────────────────────────────────
const _state = {
  open: false,
  scene3d: scene3D(),
  background: '',
  bgFit: 'cover',
  bgColor: '#0a0a14',
  dimBg: 0.0,
  chars: [],
  dialogue: { visible: false, speakerName: '', speakerColor: '#ffe066', text: '', _subtitleActive: false },
  layers: [],
  interactiveImages: [],
  // Новые флаги управления
  mouseControl: false,
  depthMode: false,
  playerControl: false,
  depthScaleMultiplier: 1.0,
  depthYMultiplier: 1.0,
  horizonLine: false,
  horizonY: 30,
  // Infinite-roster is now the only supported mode. The flag is kept for
  // backwards-compat with saved scenes and legacy code paths, but it's
  // always forced to `true` at runtime.
  infiniteRoster: true,
  hideHorizonLine: false,
};

// ─── Глобальные z-index базы ─────────────────────────────────────────────────
const ZINDEX_BASE = {
  ALL: 100,
};

// ─── Drag State ─────────────────────────────────────────────────────────────
let _dragState = {
  active: false,
  element: null,
  type: null,
  id: null,
  lastX: 0, lastY: 0,
  curX: 0, curY: 0, curZ: 0, curScale: 1,
  elemStartZ: 0, elemStartScale: 1, elemBaseScale: 1,
  stageScale: 1, pinnedWidth: 420,
  mirrorX: 1, elemW: 300, elemH: 200,
};

// ─── Horizon Line State ──────────────────────────────────────────────────────
let _horizonY = null; // Фиксированная линия горизонта (Y в пикселях стейджа)

// ─────────────────────────────────────────────────────────────────────────────
// OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNOverlay {
  static ID = 'dd-vn-overlay';
  static _lastBg = '';
  static _hoveredCharId = null;

  // ─── Scroll-to-select state ──────────────────────────────────────────────
  // При наведении мыши на сцену + прокрутка колесом → цикл по объектам под курсором
  static _scrollSelect = {
    active: false,       // включён ли режим выбора
    elemId: null,        // id выбранного элемента
    elemType: null,      // 'char' | 'layer' | 'interactive'
    candidates: [],      // [{id, type, zIndex, el}] — все элементы под курсором, по z desc
    curIdx: -1,          // текущий индекс в candidates
    mouseX: 0,
    mouseY: 0,
    hideTimer: null,
  };

  static build() {
    if (document.getElementById(this.ID)) return;
    const el = document.createElement('div');
    el.id = this.ID;
    el.innerHTML = `
      <div class="vn-bg-layer" id="vn-bg-layer"></div>
      <div id="vn-3d-host" aria-hidden="true"></div>
      <div class="vn-stage" id="vn-stage">
        <div id="vn-unified-container" class="vn-unified-container"></div>
      </div>
      <div class="vn-name-bar" id="vn-name-bar" style="display:none"></div>
      <div class="vn-dialogue-box" id="vn-dialogue" style="display:none">
        <div class="vn-dialogue-inner">
          <div class="vn-speaker" id="vn-speaker"></div>
          <div class="vn-text" id="vn-text"></div>
          <div class="vn-subtitle-line" id="vn-subtitle-line" style="display:none">
            <span class="vn-sub-name" id="vn-sub-name"></span>
            <span class="vn-sub-text" id="vn-sub-text"></span>
          </div>
          <div class="vn-subtitles-container vn-collapsed" id="vn-subtitles-container" style="display:none"></div>
          <div class="vn-chat-input-row" id="vn-chat-input-row">
            <button type="button" id="vn-chat-expand" class="vn-chat-expand" title="${game.i18n.localize('DRAMADIRECTOR.vn.chatExpand') || 'Expand / collapse chat'}"><i class="fas fa-chevron-up"></i></button>
            <input type="text" id="vn-chat-input" class="vn-chat-input" autocomplete="off" placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.chatPlaceholder') || 'Type a line and press Enter…'}" maxlength="500"/>
            <button type="button" id="vn-chat-clear" class="vn-chat-clear" title="${game.i18n.localize('DRAMADIRECTOR.vn.chatClear') || 'Clear chat log'}"><i class="fas fa-trash"></i></button>
          </div>
        </div>
      </div>
      <div class="vn-gm-controls" id="vn-gm-bar" style="display:none">
        <span class="vn-gm-label"><i class="fas fa-book-open"></i> VN</span>
        <button id="vn-ctrl-panel" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.settings')}"><i class="fas fa-cog"></i></button>
        <button id="vn-ctrl-quicksave" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.quickSave') || 'Quick Save Scene'}"><i class="fas fa-save"></i></button>
        <span id="vn-ctrl-autosave-badge" class="vn-autosave-badge" style="display:none" title="AutoSave"><i class="fas fa-history"></i></span>
        <button id="vn-ctrl-show-players" class="vn-btn-show-players" style="display:none" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.showPlayers') || 'Показать игрокам'}"><i class="fas fa-eye"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.overlay.showPlayers') || 'Показать игрокам'}</button>
        <button id="vn-ctrl-stop" class="vn-btn-danger"><i class="fas fa-stop"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.overlay.close')}</button>
      </div>
      <div class="vn-quick-bar" id="vn-quick-bar" style="display:none">
        <select id="vn-quick-lang" class="vn-quick-lang-sel" title="${game.i18n.localize('DRAMADIRECTOR.vn.micLanguage')}">
          <option value="ru-RU">RU</option>
          <option value="en-US">EN</option>
          <option value="de-DE">DE</option>
          <option value="fr-FR">FR</option>
          <option value="ja-JP">JP</option>
          <option value="zh-CN">中文</option>
        </select>
        <div class="vn-quick-sep"></div>
        <div class="vn-mic-indicator" id="vn-mic-indicator">
          <button id="vn-mic-toggle" class="vn-quick-btn" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.mic')}">
            <i class="fas fa-microphone"></i>
          </button>
          <span class="vn-mic-dot"></span>
        </div>
        <div class="vn-quick-sep"></div>
        <button class="vn-quick-btn" data-sidebar-tab="chat" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.chat')}">
          <i class="fas fa-comments"></i>
        </button>
        <button class="vn-quick-btn" data-sidebar-tab="actors" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.actors')}">
          <i class="fas fa-users"></i>
        </button>
        <button class="vn-quick-btn" data-sidebar-tab="scenes" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.scenes')}">
          <i class="fas fa-map"></i>
        </button>
        <button class="vn-quick-btn" data-sidebar-tab="playlists" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.playlists')}">
          <i class="fas fa-music"></i>
        </button>
        <button class="vn-quick-btn" data-sidebar-tab="items" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.items')}">
          <i class="fas fa-suitcase"></i>
        </button>
        <div class="vn-quick-sep"></div>
        <button id="vn-quick-emotion" class="vn-quick-btn" title="${game.i18n.localize('DRAMADIRECTOR.vn.emotions') || 'Эмоции'}">
          <i class="fas fa-theater-masks"></i>
        </button>
      </div>
      <div class="vn-player-controls" id="vn-player-bar" style="display:none">
        <button id="vn-player-close" class="vn-btn-danger" title="${game.i18n.localize('DRAMADIRECTOR.vn.overlay.closeScene') || 'Закрыть сцену'}"><i class="fas fa-times"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.overlay.closeScene') || 'Закрыть сцену'}</button>
      </div>
      <div id="vn-gm-left-bar" style="display:none"></div>`;
    (document.getElementById('interface') || document.body).appendChild(el);

    el.querySelector('#vn-ctrl-stop')?.addEventListener('click', () => DDVNManager.stop(true));
    el.querySelector('#vn-ctrl-panel')?.addEventListener('click', () => DDVNApi.openPanel());
    if (game.user?.isGM) {
      const browserButton = document.createElement('button'); browserButton.type = 'button'; browserButton.textContent = 'Элементы (B)'; browserButton.title = 'Браузер элементов сцены';
      browserButton.onclick = () => window.dispatchEvent(new CustomEvent('vn-scene-browser'));
      el.querySelector('#vn-gm-bar')?.append(browserButton);
    }
    el.querySelector('#vn-ctrl-quicksave')?.addEventListener('click', () => DDVNManager.quickSaveScene());
    el.querySelector('#vn-ctrl-show-players')?.addEventListener('click', () => DDVNManager.showToPlayers());

    // Player close button — hides VN overlay locally for this player
    el.querySelector('#vn-player-close')?.addEventListener('click', () => DDVNManager.playerCloseLocal());

    el.querySelectorAll('[data-sidebar-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.sidebarTab;
        const tab = ui[tabName];
        if (tab?.renderPopout) tab.renderPopout();
        else if (tab?.popOut !== undefined) tab.renderPopout?.();
      });
    });

    el.querySelector('#vn-mic-toggle')?.addEventListener('click', async () => {
      if (DDVNMic._active) DDVNMic.stop();
      else await DDVNMic.start();
      this.updateMicIndicator();
    });
    const sttButton = document.createElement('button');
    sttButton.type = 'button'; sttButton.className = 'vn-quick-btn'; sttButton.textContent = 'STT';
    sttButton.title = 'Whisper / настройки распознавания';
    el.querySelector('#vn-mic-indicator')?.append(sttButton);
    sttButton.addEventListener('click', () => {
      let popup = el.querySelector('.vn-stt-popup');
      if (popup) { popup.remove(); return; }
      popup = document.createElement('div'); popup.className = 'vn-stt-popup';
      el.append(popup); mountSTTSettings(popup, () => DDVNMic.restartSpeech());
    });

    el.querySelector('#vn-quick-lang')?.addEventListener('change', (e) => {
      const lang = e.target.value;
      DDVNMic.lang = lang;
      const panelLang = document.getElementById('vn-mic-lang');
      if (panelLang) panelLang.value = lang;
      if (DDVNMic._active) { DDVNMic.stop(); DDVNMic.start(); }
    });

    // Emotion button for players
    el.querySelector('#vn-quick-emotion')?.addEventListener('click', () => {
      DDVNEmotionManager.togglePlayerMenu();
    });

    // ── Inline chat input (always-available text fallback for STT) ──────
    // Pressing Enter commits the line as a final subtitle: it goes into
    // the local chat log and gets broadcast to every connected client.
    const chatInput = el.querySelector('#vn-chat-input');
    chatInput?.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      // Reuse the same path the SR final-result uses so the line gets the
      // current speaker's name/colour and broadcasts identically.
      DDVNManager.onSpeechResult(text, true);
      chatInput.value = '';
    });
    // Stop Foundry's hotkeys (T for chat, etc.) from hijacking typing.
    chatInput?.addEventListener('keydown', (ev) => ev.stopPropagation());
    chatInput?.addEventListener('keyup',   (ev) => ev.stopPropagation());
    chatInput?.addEventListener('keypress',(ev) => ev.stopPropagation());

    el.querySelector('#vn-chat-clear')?.addEventListener('click', () => {
      DDVNOverlay.hideAllSubtitles();
    });

    el.querySelector('#vn-chat-expand')?.addEventListener('click', (ev) => {
      const c = document.getElementById('vn-subtitles-container');
      if (!c) return;
      const expanded = c.classList.toggle('vn-collapsed') === false;
      const icon = ev.currentTarget.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-chevron-up',   !expanded);
        icon.classList.toggle('fa-chevron-down',  expanded);
      }
      // Stay pinned to the newest line when expanding/collapsing.
      c.scrollTop = c.scrollHeight;
    });

    window.addEventListener('resize', () => this.fitStage());
    this.fitStage();
    this._initScrollSelect();

    // Mic toggle is now handled via game.keybindings (registered in drama-director.mjs)
  }

  // ─── Scroll-to-select: колесо мыши для выбора объектов под курсором ─────────
  static _initScrollSelect() {
    const stage = document.getElementById('vn-stage');
    if (!stage) return;
    const ss = this._scrollSelect;

    // Уход со сцены → снять подсветку
    stage.addEventListener('mouseleave', () => {
      clearTimeout(ss.hideTimer);
      ss.hideTimer = setTimeout(() => this._clearScrollSelect(), 600);
    });
    stage.addEventListener('mouseenter', () => clearTimeout(ss.hideTimer));

    // ── Player scroll-to-select: прокрутка колесом → выбор персонажа игрока ──
    // Работает только для не-ГМ при mouseControl + playerControl.
    // Игрок всегда выбирает только своего привязанного персонажа.
    stage.addEventListener('wheel', (e) => {
      if (!_state.mouseControl)  return;
      if (game.user?.isGM)       return;  // ГМ обрабатывается ниже
      if (!_state.playerControl) return;
      if (_dragState.active)     return;

      const myChar = _state.chars.find(c => c.playerId === game.userId);
      if (!myChar || myChar.locked) return;

      e.preventDefault();
      e.stopPropagation();

      ss.active   = true;
      ss.elemId   = myChar.id;
      ss.elemType = 'char';

      this._applyScrollHighlight(myChar.id, 'char');

      // Выводим персонажа на первый план — поднимаем z-index DOM-элемента
      // без изменения _state, чтобы не делать broadcast (только локально).
      const container = document.getElementById('vn-unified-container');
      if (container) {
        // Сначала снимаем предыдущий подъём если был
        container.querySelectorAll('[data-char-id]').forEach(el => {
          if (el._playerScrollZ !== undefined) {
            el.style.zIndex = el._playerScrollZ;
            delete el._playerScrollZ;
          }
        });
        const charEl = container.querySelector(`[data-char-id="${myChar.id}"]`);
        if (charEl) {
          charEl._playerScrollZ = charEl.style.zIndex;
          charEl.style.zIndex = String((parseInt(charEl.style.zIndex) || 100) + 1000);
        }
      }

      // Простой тост для игрока
      let toast = document.getElementById('vn-scroll-select-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'vn-scroll-select-toast';
        toast.style.cssText = [
          'position:fixed','bottom:72px','left:50%',
          'transform:translateX(-50%)',
          'background:rgba(10,10,20,.88)',
          'border:1px solid rgba(255,255,255,.18)',
          'border-radius:10px',
          'padding:8px 14px 6px',
          'font-size:12px','font-family:monospace','color:#e8e8f0',
          'pointer-events:none','z-index:99999',
          'backdrop-filter:blur(6px)','transition:opacity .25s',
          'white-space:nowrap','min-width:160px','text-align:left',
          'box-shadow:0 4px 24px rgba(0,0,0,.5)',
        ].join(';');
        document.body.appendChild(toast);
      }
      toast.innerHTML =
        `<div style="color:#fff;background:rgba(255,255,255,.1);border-radius:4px;padding:1px 4px;">` +
        `<span style="color:#fff;font-weight:bold">▶ </span>👤 ${myChar.name || 'Персонаж'}</div>` +
        `<div style="color:#555;font-size:10px;margin-top:4px;border-top:1px solid rgba(255,255,255,.08);padding-top:4px;">` +
        `🖱 ЛКМ — двигать</div>`;
      toast.style.opacity = '1';

      clearTimeout(ss.hideTimer);
      ss.hideTimer = setTimeout(() => this._clearScrollSelect(), 2500);
    }, { passive: false });

    // Scroll без Ctrl → scroll-to-select (ГМ)
    stage.addEventListener('wheel', (e) => {
      if (!_state.mouseControl) return;
      if (!game.user?.isGM)     return;
      if (_dragState.active)    return;

      // Ctrl+scroll на выбранном через колесико объекте → меняем baseScale
      if (e.ctrlKey) {
        if (!ss.active) return;
        e.preventDefault();
        e.stopPropagation();
        const item = this._getItemById(ss.elemType, ss.elemId);
        if (!item) return;
        const step = e.deltaY < 0 ? 0.05 : -0.05;
        item.baseScale = parseFloat(Math.max(0.05, Math.min(15, (item.baseScale || 1) + step)).toFixed(2));
        if (_state.depthMode) {
          const ey = ss.elemType === 'char' ? 1080 + (item.y || 0) : (item.y || 0);
          item.scale = parseFloat((item.baseScale * DDVNOverlay._perspectiveFactor(ey)).toFixed(3));
        } else {
          item.scale = item.baseScale;
        }
        DDVNManager.broadcast();
        const toast = document.getElementById('vn-basescale-toast') || (() => {
          const t = document.createElement('div'); t.id = 'vn-basescale-toast';
          t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#ffe066;padding:6px 16px;border-radius:20px;font-size:13px;font-family:monospace;pointer-events:none;z-index:99999;transition:opacity .3s;';
          document.body.appendChild(t); return t;
        })();
        toast.textContent = `Base Scale: ${item.baseScale}×`;
        toast.style.opacity = '1';
        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1200);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const hits = this._getElementsAt(e.clientX, e.clientY);
      if (!hits.length) { this._clearScrollSelect(); return; }

      const hitKey = hits.map(h => h.type + h.id).join('|');
      if (ss._lastHitKey !== hitKey) {
        // Курсор попал на новую группу объектов — начинаем с верхнего
        ss._lastHitKey  = hitKey;
        ss.candidates   = hits; // отсортированы по z убыванию (верхний первый)
        ss.curIdx       = 0;
      } else {
        // Крутим по циклу: вниз → глубже (следующий), вверх → ближе
        const dir = e.deltaY > 0 ? 1 : -1;
        ss.curIdx = (ss.curIdx + dir + hits.length) % hits.length;
      }

      const chosen   = hits[ss.curIdx];
      ss.active      = true;
      ss.elemId      = chosen.id;
      ss.elemType    = chosen.type;

      this._applyScrollHighlight(chosen.id, chosen.type);
      this._showScrollToast(hits, ss.curIdx);

      clearTimeout(ss.hideTimer);
      ss.hideTimer = setTimeout(() => this._clearScrollSelect(), 2500);
    }, { passive: false });

    // ЛКМ по сцене: если есть активный выбор → начать drag на нём
    stage.addEventListener('mousedown', (e) => {
      if (e.button !== 0)    return;
      if (!ss.active)        return;
      if (_dragState.active) return;

      const item = this._getItemById(ss.elemType, ss.elemId);
      if (!item || item.locked)               return;
      if (!this._canDragElement(item, _state)) return;

      const container = document.getElementById('vn-unified-container');
      if (!container) return;
      const selector =
        ss.elemType === 'char'        ? `[data-char-id="${ss.elemId}"]`  :
        ss.elemType === 'layer'       ? `[data-layer-id="${ss.elemId}"]` :
                                        `[data-img-id="${ss.elemId}"]`;
      const selEl = container.querySelector(selector);
      if (!selEl) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const stageEl    = document.getElementById('vn-stage');
      const stageRect  = stageEl?.getBoundingClientRect();
      const stageScale = stageRect
        ? Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
        : 1;

      // Cancel any pending autosave timer — it could fire mid-drag and capture
      // an intermediate position. The timer restarts cleanly after drag ends.
      clearTimeout(DDVNManager._autoSaveTimer);
      DDVNManager._autoSaveTimer = null;

      _dragState = {
        active: true,
        element: selEl,
        type: ss.elemType,
        id: ss.elemId,
        lastX: e.clientX,
        lastY: e.clientY,
        curX: (ss.elemType === 'char') ? (parseFloat(selEl.style.left) || 0) : (item.x || 0),
        curY: item.y || 0,
        elemStartZ: item.zIndex || 0,
        elemStartScale: item.scale || 1,
        elemBaseScale: item.baseScale ?? item.scale ?? 1,
        stageScale,
        pinnedWidth: parseFloat(selEl.style.width) || 420,
      };

      selEl.style.cursor = 'grabbing';
      selEl.style.zIndex = (parseInt(selEl.style.zIndex) || 100) + 1000;

      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup',   this._onDragEnd);

      this._clearScrollSelect();
    }, true);

    // ПКМ по сцене: если есть выбранный через колесо объект → заблокировать/разблокировать
    stage.addEventListener('contextmenu', (e) => {
      if (!_state.mouseControl) return;
      if (!game.user?.isGM)     return;
      if (!ss.active)           return;
      e.preventDefault();
      e.stopPropagation();
      const item = this._getItemById(ss.elemType, ss.elemId);
      if (!item) return;
      const willBeLocked = !item.locked;
      DDVNManager.toggleLock(ss.elemType, ss.elemId);
      // Показываем тост с результатом блокировки
      this._showLockToast(willBeLocked, item.name);
      this._clearScrollSelect();
    }, true);
  }

  // Собирает все DOM-элементы сцены под точкой экрана, сортирует по z-index убыванию
  static _getElementsAt(clientX, clientY) {
    const container = document.getElementById('vn-unified-container');
    if (!container) return [];

    const results  = [];

    // Используем elementsFromPoint для получения всех слоёв
    const allHit = document.elementsFromPoint(clientX, clientY);

    for (const hitEl of allHit) {
      // Ищем ближайший родительский элемент с data-elem-type
      let el = hitEl;
      while (el && el !== container) {
        if (el.dataset?.elemType) break;
        el = el.parentElement;
      }
      if (!el || !el.dataset?.elemType) continue;
      if (results.find(r => r.el === el)) continue; // дубликат

      const type = el.dataset.elemType;
      const id   =
        type === 'char'        ? el.dataset.charId  :
        type === 'layer'       ? el.dataset.layerId :
                                 el.dataset.imgId;
      if (!id) continue;

      // Alpha test: for char/layer images, skip if cursor is on transparent pixel
      const topImg = hitEl.tagName === 'IMG' ? hitEl : el.querySelector('img');
      if (topImg && type !== 'interactive') {
        if (!this._checkPixelAlpha(topImg, clientX, clientY)) continue;
      }

      const zIndex = parseInt(el.style.zIndex) || 0;
      results.push({ id, type, zIndex, el });
    }

    // Сортируем по z убыванию (верхний — первый)
    results.sort((a, b) => b.zIndex - a.zIndex);
    return results;
  }

  // Помощник: достаёт объект данных по type+id из _state
  static _getItemById(type, id) {
    if (type === 'char')        return _state.chars.find(c => c.id === id) ?? null;
    if (type === 'layer')       return _state.layers.find(l => l.id === id) ?? null;
    if (type === 'interactive') return _state.interactiveImages.find(i => i.id === id) ?? null;
    return null;
  }

  // Подсвечивает выбранный элемент белым ореолом
  static _applyScrollHighlight(id, type) {
    if (SceneEditor.browser) SceneEditor.select(`${type}:${id}`, true);
    const container = document.getElementById('vn-unified-container');
    if (!container) return;

    // Снимаем прошлое выделение
    container.querySelectorAll('.vn-scroll-selected').forEach(el => {
      el.classList.remove('vn-scroll-selected');
    });

    const selector =
      type === 'char'        ? `[data-char-id="${id}"]`  :
      type === 'layer'       ? `[data-layer-id="${id}"]` :
                               `[data-img-id="${id}"]`;
    const el = container.querySelector(selector);
    if (el) {
      el.classList.add('vn-scroll-selected');
    }
  }

  // Показывает небольшой тост со списком объектов и стрелкой на текущий
  static _showScrollToast(candidates, curIdx) {
    let toast = document.getElementById('vn-scroll-select-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vn-scroll-select-toast';
      toast.style.cssText = [
        'position:fixed', 'bottom:72px', 'left:50%',
        'transform:translateX(-50%)',
        'background:rgba(10,10,20,.88)',
        'border:1px solid rgba(255,255,255,.18)',
        'border-radius:10px',
        'padding:8px 14px 6px',
        'font-size:12px',
        'font-family:monospace',
        'color:#e8e8f0',
        'pointer-events:none',
        'z-index:99999',
        'backdrop-filter:blur(6px)',
        'transition:opacity .25s',
        'white-space:nowrap',
        'min-width:160px',
        'text-align:left',
        'box-shadow:0 4px 24px rgba(0,0,0,.5)',
      ].join(';');
      document.body.appendChild(toast);
    }

    const icon = t =>
      t === 'char'        ? '👤' :
      t === 'layer'       ? '🖼' :
                            '🖱';

    const lines = candidates.map((c, i) => {
      const item  = this._getItemById(c.type, c.id);
      const label = item?.name || c.type;
      const z     = item?.zIndex ?? 0;
      const isChosen = i === curIdx;
      const arrow = isChosen ? '<span style="color:#fff;font-weight:bold">▶ </span>' : '&nbsp;&nbsp;';
      const style = isChosen
        ? 'color:#fff;background:rgba(255,255,255,.1);border-radius:4px;padding:1px 4px;'
        : 'color:#aaa;padding:1px 4px;';
      return `<div style="${style}">${arrow}${icon(c.type)} ${label} <span style="color:#666;font-size:10px">z:${z}</span></div>`;
    }).join('');

    const hint = '<div style="color:#555;font-size:10px;margin-top:4px;border-top:1px solid rgba(255,255,255,.08);padding-top:4px;">🖱 scroll — выбор &nbsp;·&nbsp; ЛКМ — двигать &nbsp;·&nbsp; ПКМ — блок &nbsp;·&nbsp; Ctrl+scroll — масштаб</div>';
    toast.innerHTML = lines + hint;
    toast.style.opacity = '1';
  }

  // Тост-подтверждение блокировки объекта через ПКМ
  static _showLockToast(locked, name = '') {
    const toastId = 'vn-lock-toast';
    let toast = document.getElementById(toastId);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = toastId;
      toast.style.cssText = [
        'position:fixed', 'bottom:80px', 'left:50%',
        'transform:translateX(-50%)',
        'background:rgba(10,10,20,.9)',
        'border:1px solid rgba(255,255,255,.2)',
        'border-radius:20px',
        'padding:7px 18px',
        'font-size:13px',
        'color:#ffe066',
        'pointer-events:none',
        'z-index:99999',
        'transition:opacity .3s',
        'white-space:nowrap',
      ].join(';');
      document.body.appendChild(toast);
    }
    const label = (name ? `«${name}» ` : '');
    toast.textContent = locked
      ? `🔒 ${label}заблокирован`
      : `🔓 ${label}разблокирован`;
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1600);
  }

  // Снимает выделение и прячет тост
  static _clearScrollSelect() {
    const ss = this._scrollSelect;
    ss.active    = false;
    ss.elemId    = null;
    ss.elemType  = null;
    ss.candidates = [];
    ss.curIdx    = -1;
    ss._lastHitKey = null;

    const container = document.getElementById('vn-unified-container');
    container?.querySelectorAll('.vn-scroll-selected').forEach(el => {
      el.classList.remove('vn-scroll-selected');
    });

    // Restore any player-scroll z-index boost
    container?.querySelectorAll('[data-char-id]').forEach(el => {
      if (el._playerScrollZ !== undefined) {
        el.style.zIndex = el._playerScrollZ;
        delete el._playerScrollZ;
      }
    });

    const toast = document.getElementById('vn-scroll-select-toast');
    if (toast) {
      toast.style.opacity = '0';
      clearTimeout(toast._removeTimer);
      toast._removeTimer = setTimeout(() => toast.remove(), 280);
    }
  }

  static fitStage() {
    const stage = document.getElementById('vn-stage');
    if (!stage) return;
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `translate(-50%,-50%) scale(${scale})`;
  }

  static clearStage() {
    VN3D.dispose();
    const container = document.getElementById('vn-unified-container');
    if (container) { container.querySelectorAll('video').forEach(v => v.pause()); container.replaceChildren(); container._prevVisible = new Set(); }
    const dialogue = document.getElementById('vn-dialogue');
    if (dialogue) dialogue.style.display = 'none';
    this.hideAllSubtitles();
  }

  static moveRemoteElement(type, item) {
    const attribute = type === 'char' ? 'charId' : type === 'layer' ? 'layerId' : 'imgId';
    const el = [...(document.getElementById('vn-unified-container')?.children || [])].find(node => node.dataset[attribute] === item.id);
    if (!el) { this._renderAllElements(_state); return; }
    if (type === 'char') {
      if (item._pinned) el.style.left = `${item.x}px`;
      if (item._pinnedWidth) el.style.width = `${item._pinnedWidth}px`;
      const wrap = el.querySelector('.vn-char-wrapper'), portrait = el.querySelector('.vn-char-portrait');
      if (wrap) wrap.style.transform = `translateY(${item.y}px)`;
      if (portrait) {
        const mirror = portrait.style.transform.match(/scaleX\(([^)]+)\)/)?.[1] || '1';
        portrait.style.transform = `scaleX(${mirror}) scale(${item.scale})`;
      }
    } else {
      el.style.left = `${item.x + (item.width || 200) / 2}px`;
      el.style.top = `${item.y + (item.height || 200) / 2}px`;
      el.style.transform = `translate(-50%,-50%) scale(${item.scale})`;
    }
    el.style.zIndex = String(100 + (item.zIndex || 0) + (item.active ? 500 : 0));
    el._vnSignature = null; // Final snapshot must reconcile even if it returns to the original position.
  }

  static apply(state) {
    let overlay = document.getElementById(this.ID);
    if (!overlay) { this.build(); overlay = document.getElementById(this.ID); }
    if (!overlay) { console.error('DD VN | Cannot create overlay!'); return; }

    if (state.open) {
      // Явно выставляем display:block, чтобы переопределить CSS-правило display:none
      clearTimeout(overlay._hideTimer);
      overlay.style.display = 'block';
      overlay.classList.add('interactive');
      // Opening animation — plays once when VN is shown
      if (!overlay._wasOpen) {
        overlay.classList.remove('vn-closing');
        overlay.classList.add('vn-opening');
        setTimeout(() => overlay.classList.remove('vn-opening'), 500);
      }
      if (!overlay._wasOpen) overlay.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
      overlay._wasOpen = true;
    } else {
      overlay.classList.remove('interactive');
      overlay._wasOpen = false;
      // Closing animation
      overlay.classList.remove('vn-opening');
      overlay.classList.add('vn-closing');
      clearTimeout(overlay._hideTimer);
      overlay._hideTimer = setTimeout(() => {
        if (!overlay.classList.contains('interactive')) {
          overlay.classList.remove('vn-closing');
          overlay.style.display = 'none';
          this.clearStage();
          overlay.querySelectorAll('video').forEach(v => v.pause());
        }
      }, 550);
    }
    VN3D.sync(state, () => this._renderAllElements(DDVNManager.getState()), (patch, key, live) => DDVNManager.edit3D(patch, key, live));
    if (!SceneEditor.bridge) SceneEditor.configure({
      state: () => _state,
      patch: (key, patch, model, live) => DDVNManager.editSceneItem(key, patch, model, live),
      duplicate: key => DDVNManager.duplicateSceneItem(key),
      remove: key => DDVNManager.removeSceneItem(key),
      select: key => {
        document.querySelectorAll('.vn-scroll-selected').forEach(el => el.classList.remove('vn-scroll-selected'));
        if (!key) { VN3D.renderer?.controls.select(null); return; }
        if (VN3D.renderer?.entries.has(key)) VN3D.renderer.controls.select(key);
        else { const colon = key.indexOf(':'); DDVNOverlay._applyScrollHighlight(key.slice(colon + 1), key.slice(0, colon)); }
      },
      focus: key => {
        if (VN3D.renderer?.entries.has(key)) { VN3D.renderer.controls.select(key); VN3D.renderer.controls.focusSelection(); }
        else if (key) { const colon = key.indexOf(':'); DDVNOverlay._applyScrollHighlight(key.slice(colon + 1), key.slice(0, colon)); }
      },
      mode: mode => VN3D.renderer?.controls.setMode(mode),
      cameraShift: active => VN3D.renderer?.controls.temporaryCamera(active),
    });
    SceneEditor.sync();
    if (state.open) { this._renderBg(state); this._renderAllElements(state); }
    this._renderDialogue(state.dialogue);
    this._renderNameBar(state.chars || []);

    const gmBar = document.getElementById('vn-gm-bar');
    if (gmBar) gmBar.style.display = (state.open && game.user?.isGM) ? 'flex' : 'none';

    // "Show to Players" button — always visible when VN is open (GM only)
    const showPlayersBtn = document.getElementById('vn-ctrl-show-players');
    if (showPlayersBtn && game.user?.isGM) {
      showPlayersBtn.style.display = state.open ? 'inline-flex' : 'none';
    }

    // Player bar (close scene button) — only for non-GM when scene is shown to them
    const playerBar = document.getElementById('vn-player-bar');
    if (playerBar) playerBar.style.display = (state.open && !game.user?.isGM) ? 'flex' : 'none';
    
    const quickBar = document.getElementById('vn-quick-bar');
    if (quickBar) quickBar.style.display = state.open ? 'flex' : 'none';
    this.updateMicIndicator();

    DDVNGMBar.update(state);
  }

  static updateMicIndicator() {
    const indicator = document.getElementById('vn-mic-indicator');
    const btn = document.getElementById('vn-mic-toggle');
    const dot = indicator?.querySelector('.vn-mic-dot');
    if (!btn || !dot) return;
    
    if (DDVNMic._active) {
      btn.classList.add('vn-mic-on');
      dot.classList.add('vn-mic-dot-on');
      btn.querySelector('i')?.classList.replace('fa-microphone-slash', 'fa-microphone');
    } else {
      btn.classList.remove('vn-mic-on');
      dot.classList.remove('vn-mic-dot-on');
      btn.querySelector('i')?.classList.replace('fa-microphone', 'fa-microphone-slash');
    }
    
    const quickLang = document.getElementById('vn-quick-lang');
    if (quickLang && DDVNMic.lang) quickLang.value = DDVNMic.lang;
    const panelLang = document.getElementById('vn-mic-lang');
    if (panelLang && DDVNMic.lang) panelLang.value = DDVNMic.lang;
  }

  static ensureOpen() {
    if (!_state.open) {
      _state.open = true;
    }
    // In gmOnly mode never broadcast to players — apply locally only
    if (DDVNManager.isGmOnlyMode() || !DDVNManager.isShownToPlayers()) {
      DDVNOverlay.apply(_state);
    } else {
      DDVNManager.broadcast();
    }
  }

  static _renderBg(state) {
    const bg = document.getElementById('vn-bg-layer');
    if (!bg) return;
    const hidden = state.scene3d?.enabled && !state.scene3d.useBackground;
    bg.style.display = hidden ? 'none' : '';
    if (hidden) { bg.querySelector('video')?.pause(); return; }
    const src = state.background || '';
    const fit = ['cover', 'contain', 'fill'].includes(state.bgFit) ? state.bgFit : 'cover';
    bg.style.backgroundColor = state.bgColor || '#0a0a14';
    bg.style.setProperty('--vn-dim', String(state.dimBg || 0));
    if (src !== (bg.dataset.src || '')) {
      bg.querySelector('video')?.pause();
      bg.replaceChildren(); bg.style.backgroundImage = 'none'; bg.dataset.src = src;
      if (/\.(webm|mp4|ogv)(?:[?#]|$)/i.test(src)) {
        const video = document.createElement('video');
        video.src = src; video.autoplay = video.loop = video.muted = true;
        video.playsInline = true; video.style.cssText = 'width:100%;height:100%;';
        bg.append(video); video.play().catch(() => {});
      } else if (src) bg.style.backgroundImage = `url(${JSON.stringify(src)})`;
    }
    bg.style.backgroundSize = fit === 'fill' ? '100% 100%' : fit;
    bg.style.backgroundPosition = 'center'; bg.style.backgroundRepeat = 'no-repeat';
    const video = bg.querySelector('video');
    if (video) { video.style.objectFit = fit; if (state.open && video.paused) video.play().catch(() => {}); }
  }

  // Internal: actually rebuild the element DOM after any exit animations finish
  static _doRenderAllElements(state) { this._renderAllElements(state, true); }

  static _renderAllElements(state, _skipExitAnim = false) {
    // Hide portraits only after their model loaded successfully; preserve dialogue/name state.
    if (state.scene3d?.enabled) state = {
      ...state,
      chars: (state.chars || []).filter(c => !VN3D.hasCharacter(c.id) && (state.scene3d.overlay2d || c.model3d?.src)),
      layers: state.scene3d.overlay2d ? state.layers : [],
      interactiveImages: state.scene3d.overlay2d ? state.interactiveImages : [],
    };
    const container = document.getElementById('vn-unified-container');
    if (!container) return;

    // Build the set of IDs that will be visible in the NEW state
    const nextVisible = new Set();
    (state.chars || []).filter(c => c?.visible !== false)
      .forEach(c => nextVisible.add(c.id));
    (state.layers || []).filter(l => l?.visible !== false)
      .forEach(l => nextVisible.add(l.id));
    (state.interactiveImages || []).filter(i => i?.visible !== false && i?.src)
      .forEach(i => nextVisible.add(i.id));

    // Find elements currently in DOM that are leaving (id present but not in nextVisible)
    const _prevVisible = container._prevVisible ?? new Set();

    const previous = new Map();
    for (const el of [...container.children]) {
      if (el.dataset.vnExiting) continue;
      const id = el.dataset.charId || el.dataset.layerId || el.dataset.imgId;
      const key = `${el.dataset.elemType}:${id}`;
      previous.set(key, el);
      if (!nextVisible.has(id)) {
        el.dataset.vnExiting = 'true'; el.style.pointerEvents = 'none';
        _animateElem(el, el._vnAnimOut || 'fade', 'out', () => {
          el.querySelectorAll('video').forEach(v => v.pause()); el.remove();
        });
      }
    }
    container._prevVisible = new Set();

    const chars = state.chars || [];
    const layers = state.layers || [];
    const interactiveImages = state.interactiveImages || [];

    const hasActive = chars.some(c => c && c.active && c.visible !== false);
    const allElements = [];

    // ─── Персонажи ───
    const leftChars   = chars.filter(c => c && c.side === 'left'   && c.visible !== false).sort((a, b) => (a.slot || 0) - (b.slot || 0));
    const centerChars = chars.filter(c => c && c.side === 'center' && c.visible !== false).sort((a, b) => (a.slot || 0) - (b.slot || 0));
    const rightChars  = chars.filter(c => c && c.side === 'right'  && c.visible !== false).sort((a, b) => (a.slot || 0) - (b.slot || 0));

    const calcCharBasePos = (side, slot, totalOnSide) => {
      const basePositions = {
        left: { x: 250, y: 1080 },
        center: { x: 960, y: 1080 },
        right: { x: 1670, y: 1080 }
      };
      const base = basePositions[side];
      
      let baseWidth = side === 'center' ? 380 : 420;
      let overlap = 0;
      
      if (totalOnSide <= 3) { baseWidth = side === 'center' ? 350 : 420; overlap = 0; }
      else if (totalOnSide <= 5) { baseWidth = side === 'center' ? 280 : 350; overlap = 30; }
      else if (totalOnSide <= 8) { baseWidth = side === 'center' ? 220 : 280; overlap = 50; }
      else { baseWidth = side === 'center' ? 180 : 220; overlap = 70; }

      const slotOffset = slot * (baseWidth - overlap);
      
      let x = base.x;
      if (side === 'left') x = 100 + slotOffset;
      else if (side === 'center') x = 960 - (totalOnSide * (baseWidth - overlap)) / 2 + slotOffset;
      else if (side === 'right') x = 1820 - slotOffset - baseWidth;

      return { x, y: base.y, width: baseWidth };
    };

    const addCharElements = (charList, side) => {
      const total = charList.length;
      charList.forEach((char, idx) => {
        const basePos = calcCharBasePos(side, idx, total);
        allElements.push({
          type: 'char',
          data: char,
          zIndex: ZINDEX_BASE.ALL + (char.zIndex ?? 0) + (char.active ? 500 : 0),
          baseX: basePos.x,
          baseY: basePos.y,
          width: basePos.width,
          side,
          slot: idx,
          totalOnSide: total
        });
      });
    };

    if (state.infiniteRoster) {
      // All chars go to center stage, user manually positions via drag
      const visibleChars = chars.filter(c => c && c.visible !== false);
      visibleChars.forEach((char) => {
        allElements.push({
          type: 'char',
          data: char,
          zIndex: ZINDEX_BASE.ALL + (char.zIndex ?? 0) + (char.active ? 500 : 0),
          baseX: 960 - 210, // center stage - half width
          baseY: 1080,
          width: 420,
          side: 'center',
          slot: 0,
          totalOnSide: 1
        });
      });
    } else {
      addCharElements(leftChars, 'left');
      addCharElements(centerChars, 'center');
      addCharElements(rightChars, 'right');
    }

    layers.filter(l => l.visible !== false).forEach(layer => {
      allElements.push({ type: 'layer', data: layer, zIndex: ZINDEX_BASE.ALL + (layer.zIndex ?? 0) });
    });

    interactiveImages.filter(img => img.visible !== false && img.src).forEach(image => {
      allElements.push({ type: 'interactive', data: image, zIndex: ZINDEX_BASE.ALL + (image.zIndex ?? 0) });
    });

    allElements.sort((a, b) => a.zIndex - b.zIndex);

    // ─── Рендерим все элементы ───
    allElements.forEach(elem => {
      const dataForSignature = { ...elem.data };
      if (elem.type === 'char') delete dataForSignature.active;
      const signature = JSON.stringify([dataForSignature, elem.baseX, elem.width, elem.side, state.mouseControl, state.playerControl]);
      const key = `${elem.type}:${elem.data.id}`;
      const previousEl = previous.get(key);
      if (previousEl && !previousEl.dataset.vnExiting && previousEl._vnSignature === signature) {
        previousEl.style.zIndex = elem.zIndex;
        if (elem.type === 'char') this._updateCharActivity(previousEl, elem.data, hasActive);
        container._prevVisible.add(elem.data.id);
        return;
      }
      if (previousEl && !previousEl.dataset.vnExiting) {
        previousEl._vnAnimation?.cancel();
        previousEl.querySelectorAll('video').forEach(v => v.pause()); previousEl.remove();
      }
      const el = document.createElement('div');
      el._vnSignature = signature;
      el._vnAnimOut = elem.data.animOut || 'fade';
      const isMouseControl = state.mouseControl;
      const canDrag = this._canDragElement(elem.data, state);

      if (elem.type === 'char') {
        const char = elem.data;
        const visClass = !hasActive ? 'vn-char-all-visible' : (char.active ? 'vn-char-active' : 'vn-char-dim');
        const charColor = char.nameColor || '#ffe066';
        const charScale = char.scale || 1;
        const offsetX = char.x || 0;
        const offsetY = char.y || 0;
        const mirror = elem.side === 'center' ? !!char.mirror : (!!char.mirror !== (elem.side === 'right')); 

        el.className = `vn-char ${visClass}${char.locked ? ' vn-locked' : ''}`;
        el.dataset.charId = char.id;
        el.dataset.elemType = 'char';

        // Position: if char was ever manually dragged (pinned), use absolute x coordinate.
        // Do NOT check mouseControl — once pinned the position must survive mouseControl toggle
        // and adding/removing other chars.
        const charLeft  = char._pinned ? offsetX : (elem.baseX + offsetX);
        const charWidth = (char._pinned && char._pinnedWidth) ? char._pinnedWidth : elem.width;
        el.style.cssText = `position:absolute;left:${charLeft}px;bottom:0;width:${charWidth}px;height:900px;z-index:${elem.zIndex};`;

        const isActive     = char.active;

        // Resolve effective images: emotion overrides portrait without mutating data
        const _activeEmo = char.activeEmotion
          ? (char.emotions ?? []).find(e => e.name === char.activeEmotion)
          : null;
        const effectiveImg       = (_activeEmo?.img) ? _activeEmo.img : (char.img || '');
        const effectiveActiveImg = (_activeEmo?.img) ? _activeEmo.img : (char.activeImg || '');

        const hasMainImg   = effectiveImg.trim();
        const hasActiveImg = effectiveActiveImg.trim();

        const imgId = `char-img-${char.id}-${Date.now()}`;

        const _isVid = src => /\.(webm|mp4|ogv)(?:[?#]|$)/i.test(src);
        const _mediaEl = (src, extraClass = '', style = '') => {
          const vid = _isVid(src);
          const cursor = isMouseControl && canDrag && !char.locked ? 'grab' : 'pointer';
          if (vid) {
            return `<video class="${extraClass}" src="${src}" autoplay loop muted playsinline
              style="pointer-events:auto;cursor:${cursor};${style}"
              onerror="this.style.display='none'"></video>`;
          }
          return `<img class="${extraClass}" src="${src}" alt="${char.name || ''}"
            style="pointer-events:auto;cursor:${cursor};${style}"
            onerror="this.style.display='none'"/>`;
        };

        let portraitHtml;
        if (hasMainImg || hasActiveImg) {
          if (hasActiveImg && hasMainImg) {
            portraitHtml = `
              <div class="vn-char-img-wrap" id="${imgId}-wrap">
                ${_mediaEl(effectiveImg,       `vn-char-img-base ${isActive ? 'vn-img-hidden' : ''}`, '')}
                ${_mediaEl(effectiveActiveImg, `vn-char-img-active ${isActive ? 'vn-img-visible' : ''}`, '')}
              </div>`;
          } else {
            const src = hasMainImg ? effectiveImg : effectiveActiveImg;
            portraitHtml = _mediaEl(src, '', '');
          }
        } else {
          portraitHtml = `<div class="vn-char-empty"><i class="fas fa-user"></i></div>`;
        }

        const glowStyle = char.active ? `filter: drop-shadow(0 0 20px ${charColor}) drop-shadow(0 0 40px ${charColor}80);` : '';

        // Emotion picker removed from above character head - now accessible via GM bar and player menu
        // The _getEmojiForName helper is moved to DDVNEmotionManager for reuse

        el.innerHTML = `
          <div class="vn-char-wrapper" style="position:relative;transform:translateY(${offsetY}px);">
            <div class="vn-char-portrait" style="transform-origin:bottom center;transform:scaleX(${mirror ? -1 : 1}) scale(${charScale});${glowStyle}">
              ${portraitHtml}
              ${char.locked ? '<div class="vn-lock-badge"><i class="fas fa-lock"></i></div>' : ''}
            </div>
          </div>`;

        // Alpha-aware hover for name bar (images only)
        const imgEls = el.querySelectorAll('img');
        imgEls.forEach(img => {
          img.addEventListener('mouseenter', (ev) => {
            if (!this._checkPixelAlpha(img, ev.clientX, ev.clientY)) return;
            DDVNOverlay._hoveredCharId = char.id;
            DDVNOverlay._renderNameBar(_state.chars || []);
          });
          img.addEventListener('mouseleave', () => {
            DDVNOverlay._hoveredCharId = null;
            DDVNOverlay._renderNameBar(_state.chars || []);
          });
          img.addEventListener('mousemove', (ev) => {
            const isOver = this._checkPixelAlpha(img, ev.clientX, ev.clientY);
            const current = DDVNOverlay._hoveredCharId === char.id;
            if (isOver && !current) {
              DDVNOverlay._hoveredCharId = char.id;
              DDVNOverlay._renderNameBar(_state.chars || []);
            } else if (!isOver && current) {
              DDVNOverlay._hoveredCharId = null;
              DDVNOverlay._renderNameBar(_state.chars || []);
            }
          });
        });

        // Drag & Drop
        if (isMouseControl && canDrag && !char.locked) {
          this._setupDrag(el, 'char', char.id);
        } else if (isMouseControl && game.user?.isGM && char.locked) {
          this._setupContextMenu(el, 'char', char.id);
        }

        // ── Char interactivity: macro + hover swap (mirrors interactive images) ──
        // Active when NOT in draggable mode: either mouseControl is off, char is locked,
        // or the user is a non-GM player (who can never drag unless playerControl + assigned).
        const charIsInteractive = !isMouseControl || char.locked || !canDrag;
        if (charIsInteractive) {
          const portraitEl = el.querySelector('.vn-char-portrait');
          const imgEls2 = el.querySelectorAll('img,video');

          // Macro fires on any click (alpha-tested to avoid transparent areas)
          if (char.macroId) {
            el.addEventListener('click', (ev) => {
              const t = ev.target.closest('img,video');
              if (t && t.tagName === 'IMG' && !DDVNOverlay._checkPixelAlpha(t, ev.clientX, ev.clientY)) return;
              _execMacro(char.macroId);
            });
            // Subtle hover glow to hint the portrait is clickable
            el.addEventListener('mouseenter', () => {
              if (portraitEl) portraitEl.style.filter =
                (char.active ? `drop-shadow(0 0 20px ${charColor}) drop-shadow(0 0 40px ${charColor}80) ` : '') +
                'drop-shadow(0 0 18px rgba(255,220,60,.55))';
            });
            el.addEventListener('mouseleave', () => {
              if (portraitEl) portraitEl.style.filter = char.active
                ? `drop-shadow(0 0 20px ${charColor}) drop-shadow(0 0 40px ${charColor}80)` : '';
            });
          }
        }

      } else if (elem.type === 'layer') {
        const layer = elem.data;
        const layerScale = layer.scale || 1;
        const lW = layer.width  || 300;
        const lH = layer.height || 200;
        const cx = (layer.x || 0) + lW / 2;
        const cy = (layer.y || 0) + lH / 2;
        el.className = `vn-layer-item${layer.locked ? ' vn-locked' : ''}`;
        el.dataset.layerId = layer.id;
        el.dataset.elemType = 'layer';
        el.style.cssText = `position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-50%) scale(${layerScale});transform-origin:center center;z-index:${elem.zIndex};opacity:${layer.opacity??1};`;
        
        if (layer.type === 'image' && layer.src) {
          const isVid = /\.(webm|mp4|ogv)(?:[?#]|$)/i.test(layer.src);
          const cur   = isMouseControl && !layer.locked ? 'grab' : 'default';
          // Build via DOM API to avoid HTML injection from filename / src.
          const media = document.createElement(isVid ? 'video' : 'img');
          media.src   = layer.src;
          media.style.cssText = `width:${lW}px;height:${lH}px;object-fit:contain;display:block;cursor:${cur};`;
          if (isVid) {
            media.autoplay = true; media.loop = true; media.muted = true;
            media.setAttribute('playsinline', '');
          } else {
            media.onerror = () => { media.style.display = 'none'; };
          }
          el.replaceChildren(media);
        } else if (layer.type === 'text' && layer.text) {
          // Text content via textContent to neutralize HTML injection.
          // Inline styles are constructed from per-layer settings, which the GM
          // controls via the form and we sanitize numeric ranges; we still send
          // them through CSS rather than concat into HTML.
          const inner = document.createElement('div');
          inner.style.width      = `${layer.width || 400}px`;
          inner.style.fontSize   = `${layer.fontSize || 28}px`;
          inner.style.color      = String(layer.color      || '#fff');
          inner.style.fontFamily = String(layer.fontFamily || 'inherit');
          inner.style.textAlign  = String(layer.textAlign  || 'left');
          inner.style.textShadow = '0 2px 10px rgba(0,0,0,.95),0 0 20px rgba(0,0,0,.8)';
          inner.style.lineHeight = '1.4';
          inner.style.whiteSpace = 'pre-wrap';
          inner.style.cursor     = isMouseControl && !layer.locked ? 'grab' : 'default';
          inner.textContent      = layer.text;
          el.replaceChildren(inner);
        }
        
        if (layer.locked) {
          const badge = document.createElement('div');
          badge.className = 'vn-lock-badge';
          const icon = document.createElement('i');
          icon.className = 'fas fa-lock';
          badge.appendChild(icon);
          el.appendChild(badge);
        }

        if (isMouseControl && !layer.locked) {
          this._setupDrag(el, 'layer', layer.id);
        } else if (isMouseControl && game.user?.isGM && layer.locked) {
          this._setupContextMenu(el, 'layer', layer.id);
        }

      } else if (elem.type === 'interactive') {
        const image = elem.data;
        const imgScale = image.scale || 1;
        const iW = image.width  || 200;
        const iH = image.height || 200;
        const icx = (image.x || 0) + iW / 2;
        const icy = (image.y || 0) + iH / 2;
        el.className = `vn-interactive-img-item${image.locked ? ' vn-locked' : ''}`;
        el.dataset.imgId = image.id;
        el.dataset.elemType = 'interactive';
        el.style.cssText = `position:absolute;left:${icx}px;top:${icy}px;width:${iW}px;height:${iH}px;transform:translate(-50%,-50%) scale(${imgScale});transform-origin:center center;z-index:${elem.zIndex};opacity:${image.opacity??1};cursor:${isMouseControl && !image.locked ? 'grab' : 'pointer'};transition:filter .2s;`;
        // Build via DOM API to avoid HTML injection from filename / image name.
        {
          const imgNode = document.createElement('img');
          imgNode.src   = image.src;
          imgNode.title = String(image.name || '');
          imgNode.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
          imgNode.onerror = () => { imgNode.style.display = 'none'; };
          el.replaceChildren(imgNode);
        }
        
        // Locked objects OR non-mouseControl mode → act as interactive (macro/hover)
        const isInteractiveMode = !isMouseControl || image.locked;
        const imgEl = el.querySelector('img');

        if (isInteractiveMode && image.macroId && image.triggerOnClick !== false && !image.triggerOnHover) {
          el.addEventListener('click', () => { _execMacro(image.macroId); });
        }

        if (isInteractiveMode) {
          // Hover glow + optional image swap
          el.addEventListener('mouseenter', () => {
            el.style.filter = 'brightness(1.2) drop-shadow(0 0 12px rgba(255,220,60,.6))';
            el.style.transform = `translate(-50%,-50%) scale(${imgScale * 1.05})`;
            if (image.hoverSrc?.trim() && image.triggerOnHover && imgEl) imgEl.src = image.hoverSrc;
          });
          el.addEventListener('mouseleave', () => {
            el.style.filter = '';
            el.style.transform = `translate(-50%,-50%) scale(${imgScale})`;
            if (image.hoverSrc?.trim() && image.triggerOnHover && imgEl) imgEl.src = image.src;
          });
          // Click-to-swap image
          if (image.hoverSrc?.trim() && image.triggerOnClick && imgEl) {
            let _toggled = false;
            el.addEventListener('click', () => {
              _toggled = !_toggled;
              imgEl.src = _toggled ? image.hoverSrc : image.src;
            });
          }
        }

        if (image.locked) {
          const badge = document.createElement('div');
          badge.className = 'vn-lock-badge';
          const icon = document.createElement('i');
          icon.className = 'fas fa-lock';
          badge.appendChild(icon);
          el.appendChild(badge);
        }

        if (isMouseControl && !image.locked) {
          this._setupDrag(el, 'interactive', image.id);
        } else if (isMouseControl && game.user?.isGM && image.locked) {
          this._setupContextMenu(el, 'interactive', image.id);
        }
      }

      // Track current visibility and play animIn for newly-appeared elements
      const elemId = elem.data?.id;
      if (elemId) {
        container._prevVisible.add(elemId);
        const isNew = !_prevVisible.has(elemId) && !_skipExitAnim;
        if (isNew) {
          const animIn = elem.data?.animIn || 'fade';
          if (animIn && animIn !== 'none') {
            requestAnimationFrame(() => _animateElem(el, animIn, 'in'));
          }
        }
      }

      container.appendChild(el);
      if (SceneEditor.selected === `${elem.type}:${elem.data.id}`) el.classList.add('vn-scroll-selected');
      if (game.user?.isGM) {
        const key = `${elem.type === 'interactive' ? 'interactive' : elem.type}:${elem.data.id}`;
        el.addEventListener('pointerdown', () => { if (_state.mouseControl && SceneEditor.browser) SceneEditor.select(key, true); }, { capture: true });
        el.addEventListener('dblclick', e => { if (_state.mouseControl) { e.preventDefault(); e.stopPropagation(); SceneEditor.properties(key); } });
      }
    });


  }

  static _updateCharActivity(el, char, hasActive) {
    el.classList.toggle('vn-char-all-visible', !hasActive);
    el.classList.toggle('vn-char-active', hasActive && !!char.active);
    el.classList.toggle('vn-char-dim', hasActive && !char.active);
    el.querySelector('.vn-char-img-base')?.classList.toggle('vn-img-hidden', !!char.active);
    el.querySelector('.vn-char-img-active')?.classList.toggle('vn-img-visible', !!char.active);
    const portrait = el.querySelector('.vn-char-portrait');
    if (portrait) portrait.style.filter = char.active ? `drop-shadow(0 0 20px ${char.nameColor || '#ffe066'})` : '';
  }

  static _canDragElement(elemData, state) {
    if (!state.mouseControl) return false;
    if (game.user?.isGM) return true;
    if (!state.playerControl) return false;
    // Игроки могут двигать только свои персонажи
    if (elemData.playerId === game.userId) return true;
    return false;
  }

  // ─── Alpha pixel test: returns true if pixel under cursor is non-transparent ─
  static _checkPixelAlpha(imgEl, clientX, clientY, threshold = 10) {
    if (!imgEl || imgEl.tagName !== 'IMG') return true; // non-img → always hit
    try {
      const rect = imgEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      const xRatio = (clientX - rect.left) / rect.width;
      const yRatio = (clientY - rect.top) / rect.height;
      if (xRatio < 0 || xRatio > 1 || yRatio < 0 || yRatio > 1) return false;
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl,
        Math.floor(xRatio * (imgEl.naturalWidth  || imgEl.width)),
        Math.floor(yRatio * (imgEl.naturalHeight || imgEl.height)),
        1, 1, 0, 0, 1, 1
      );
      return ctx.getImageData(0, 0, 1, 1).data[3] > threshold;
    } catch (_e) {
      return true; // CORS or decode error → allow hit
    }
  }

  // ─── Perspective factor for depth mode ────────────────────────────────────
  // Returns a value [0.02..2.0] representing how large the object should appear
  // based on its Y position relative to the horizon line.
  // At the horizon → ~0, at the bottom (y=1080) → scaleMult.
  static _perspectiveFactor(y, state = _state) {
    const horizonRef = (state.horizonLine && _horizonY !== null)
      ? _horizonY
      : Math.round((state.horizonY ?? 30) / 100 * 1080);
    const stageH = 1080;
    const usableH = Math.max(1, stageH - horizonRef);
    const t = (y - horizonRef) / usableH; // 0 at horizon, 1 at bottom
    const scaleMult = state.depthScaleMultiplier || 1.0;
    return Math.max(0.02, Math.min(3.0, t * scaleMult));
  }

  // Персонажи позиционируются от bottom:0 — их Y это translateY смещение (0 = низ сцены).
  // Для перспективы нужен Y от верха: effectiveY = stageH + char.y
  // Слои и интерактивные — top-based, их Y уже правильный.
  static _depthY(type, item) {
    if (type === 'char') return 1080 + (item.y || 0);
    return item.y || 0;
  }

  static _depthZ(type, item) {
    const ey = this._depthY(type, item);
    return Math.max(-50, Math.min(100, Math.round((ey / 1080) * 100)));
  }

  // Только контекстное меню (ПКМ) — для заблокированных элементов, чтобы GM мог разблокировать
  static _setupContextMenu(el, type, id) {
    el.style.pointerEvents = 'auto';
    el.addEventListener('contextmenu', (e) => {
      if (!game.user?.isGM) return;
      if (!_state.mouseControl) return;
      e.preventDefault();
      e.stopPropagation();
      DDVNManager.toggleLock(type, id);
    });
    this._setupBaseScaleScroll(el, type, id);
  }

  // ─── Ctrl+Scroll для baseScale ────────────────────────────────────────────
  static _setupBaseScaleScroll(el, type, id) {
    el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      if (!game.user?.isGM) return;
      if (!_state.mouseControl) return;
      e.preventDefault();
      e.stopPropagation();

      const state = DDVNManager.getState();
      let item = null;
      if (type === 'char') item = state.chars.find(c => c.id === id);
      else if (type === 'layer') item = state.layers.find(l => l.id === id);
      else if (type === 'interactive') item = state.interactiveImages.find(i => i.id === id);
      if (!item) return;

      const step = e.deltaY < 0 ? 0.05 : -0.05;
      item.baseScale = parseFloat(Math.max(0.05, Math.min(10, (item.baseScale || 1) + step)).toFixed(2));

      // В режиме глубины сразу пересчитываем scale
      if (_state.depthMode) {
        // Для персонажей effectiveY = 1080 + item.y (bottom-based);
        // для слоёв и интерактивных элементов effectiveY = item.y (top-based).
        const effectiveY = type === 'char' ? 1080 + (item.y || 0) : (item.y || 0);
        item.scale = parseFloat((item.baseScale * DDVNOverlay._perspectiveFactor(effectiveY)).toFixed(3));
      } else {
        item.scale = item.baseScale;
      }

      DDVNManager.broadcast();
      // Показываем мини-тост с текущим baseScale
      const toast = document.getElementById('vn-basescale-toast') || (() => {
        const t = document.createElement('div');
        t.id = 'vn-basescale-toast';
        t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#ffe066;padding:6px 16px;border-radius:20px;font-size:13px;font-family:monospace;pointer-events:none;z-index:99999;transition:opacity .3s;';
        document.body.appendChild(t);
        return t;
      })();
      toast.textContent = `Base Scale: ${item.baseScale}×`;
      toast.style.opacity = '1';
      clearTimeout(toast._hideTimer);
      toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 1200);
    }, { passive: false });
  }

  static _setupDrag(el, type, id) {
    el.style.pointerEvents = 'auto';
    
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Только ЛКМ

      // Don't start drag when clicking on emotion picker buttons
      if (e.target.closest('.vn-emotion-picker')) return;

      // Alpha test: don't start drag on transparent pixels of images
      const imgUnder = document.elementFromPoint(e.clientX, e.clientY);
      if (imgUnder?.tagName === 'IMG' && !DDVNOverlay._checkPixelAlpha(imgUnder, e.clientX, e.clientY)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const state = DDVNManager.getState();
      let item = null;
      
      if (type === 'char') item = state.chars.find(c => c.id === id);
      else if (type === 'layer') item = state.layers.find(l => l.id === id);
      else if (type === 'interactive') item = state.interactiveImages.find(i => i.id === id);
      
      if (!item || item.locked) return;
      
      // Проверяем право на перетаскивание
      if (!this._canDragElement(item, state)) return;
      
      const rect = el.getBoundingClientRect();
      const stage = document.getElementById('vn-stage');
      const stageRect = stage?.getBoundingClientRect();
      const stageScale = stageRect ? Math.min(window.innerWidth / 1920, window.innerHeight / 1080) : 1;
      
      // Cancel any pending autosave timer — it could fire mid-drag and capture
      // an intermediate position. The timer restarts cleanly after drag ends.
      clearTimeout(DDVNManager._autoSaveTimer);
      DDVNManager._autoSaveTimer = null;

      _dragState = {
        active: true,
        element: el,
        type: type,
        id: id,
        // Incremental tracking: lastX/lastY updated every frame.
        // This prevents drift when hitting constraints (no accumulated delta).
        lastX: e.clientX,
        lastY: e.clientY,
        // For chars: use absolute stage-left from rendered CSS to avoid position
        // jumping when totalOnSide changes (adding/removing chars shifts baseX).
        curX: (type === 'char') ? (parseFloat(el.style.left) || 0) : (item.x || 0),
        curY: item.y || 0,
        curZ: item.zIndex || 0,
        curScale: item.scale || 1,
        elemStartZ: item.zIndex || 0,
        elemStartScale: item.scale || 1,
        elemBaseScale: item.baseScale ?? item.scale ?? 1,
        stageScale: stageScale,
        pinnedWidth: parseFloat(el.style.width) || 420,
        mirrorX: (() => {
          if (type !== 'char') return 1;
          const side = item.side ?? 'left';
          return side === 'center'
            ? (item.mirror ? -1 : 1)
            : ((item.mirror ? 1 : 0) ^ (side === 'right' ? 1 : 0)) ? -1 : 1;
        })(),
        elemW: item.width  || 300,
        elemH: item.height || 200,
      };

      el.style.cursor = 'grabbing';
      el.style.zIndex = (parseInt(el.style.zIndex) || 100) + 1000;
      // Отключаем CSS transition чтобы Y не "плыл" во время перетаскивания
      const _cw = el.querySelector('.vn-char-wrapper');
      if (_cw) _cw.style.transition = 'none';
      const _cp = el.querySelector('.vn-char-portrait');
      if (_cp) _cp.style.transition = 'none';
      
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
    });
    
    // ПКМ для блокировки (только GM)
    el.addEventListener('contextmenu', (e) => {
      if (!game.user?.isGM) return;
      if (!_state.mouseControl) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      DDVNManager.toggleLock(type, id);
    });

    // Ctrl+Scroll для baseScale (только GM)
    this._setupBaseScaleScroll(el, type, id);
  }

  static _onDragMove = (e) => {
    if (!_dragState.active) return;

    // ── Incremental delta from last frame ──
    const ddx = (e.clientX - _dragState.lastX) / _dragState.stageScale;
    const ddy = (e.clientY - _dragState.lastY) / _dragState.stageScale;
    _dragState.lastX = e.clientX;
    _dragState.lastY = e.clientY;

    let newX = _dragState.curX + ddx;
    let newY = _dragState.curY + ddy;
    let newZ = _dragState.elemStartZ;
    let newScale = _dragState.elemStartScale;

    if (_state.depthMode) {
      const yMult = _state.depthYMultiplier || 1.0;
      newY = _dragState.curY + ddy * yMult;

      if (_state.horizonLine && _horizonY !== null) {
        if (_dragState.type === 'char') newY = Math.max(_horizonY - 1080, newY);
        else newY = Math.max(_horizonY, newY);
      }

      const ey = _dragState.type === 'char' ? 1080 + newY : newY;
      newScale = parseFloat((_dragState.elemBaseScale * DDVNOverlay._perspectiveFactor(ey)).toFixed(3));
      newZ = Math.max(-50, Math.min(100, Math.round((ey / 1080) * 100)));
    }

    newX = Math.max(-1920, Math.min(3840, newX));
    newY = Math.max(-1080, Math.min(2160, newY));

    _dragState.curX = newX;
    _dragState.curY = newY;
    _dragState.curZ = newZ;
    _dragState.curScale = newScale;

    // updateElementPosition обновляет state + двигает DOM напрямую (без apply через broadcast)
    DDVNManager.updateElementPosition(_dragState.type, _dragState.id, {
      x:      Math.round(newX),
      y:      Math.round(newY),
      zIndex: newZ,
      scale:  parseFloat(newScale.toFixed(2)),
    });
  }

  static _onDragEnd = (e) => {
    const finId   = _dragState.id;
    const finType = _dragState.type;

    if (_dragState.element) {
      _dragState.element.style.cursor = 'grab';
      // Возвращаем transitions после окончания перетаскивания
      const _cw = _dragState.element.querySelector('.vn-char-wrapper');
      if (_cw) _cw.style.transition = '';
      const _cp = _dragState.element.querySelector('.vn-char-portrait');
      if (_cp) _cp.style.transition = '';
    }

    // Finalize absolute position pinning for chars
    if (_dragState.type === 'char' && _state.mouseControl) {
      const item = _state.chars.find(c => c.id === _dragState.id);
      if (item) {
        item._pinned = true;
        if (!item._pinnedWidth) item._pinnedWidth = _dragState.pinnedWidth || 420;
      }
    }
    
    // ── dragState уже актуален из mousemove; финальный broadcast запускает apply() ──
    // (broadcast() во время drag пропускает apply, но тут _dragState.active уже false)

    _dragState = {
      active: false,
      element: null,
      type: null,
      id: null,
      lastX: 0,
      lastY: 0,
      curX: 0,
      curY: 0,
      curZ: 0,
      curScale: 1,
      elemStartZ: 0,
      elemStartScale: 1,
    };
    
    document.removeEventListener('mousemove', this._onDragMove);
    document.removeEventListener('mouseup', this._onDragEnd);

    // _dragState.active теперь false → broadcast() запустит apply() для финальной синхронизации
    DDVNManager.broadcast();

    // Обновляем слайдеры в панели
    DDVNManager._syncPanelFields(finType, finId);
  }


  static _renderNameBar(chars) {
    const bar = document.getElementById('vn-name-bar');
    if (!bar) return;
    const activeChars = chars.filter(c => c.active && c.visible !== false && c.name?.trim());
    const hoveredChar = this._hoveredCharId ? chars.find(c => c.id === this._hoveredCharId) : null;
    const allVisible = [...activeChars];
    if (hoveredChar && !activeChars.find(c => c.id === hoveredChar.id) && hoveredChar.name?.trim()) {
      allVisible.push(hoveredChar);
    }
    if (!allVisible.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = allVisible.map((c, i) =>
      (i > 0 ? '<span class="vn-name-bar-sep">·</span>' : '') +
      `<span class="vn-name-bar-name">${c.name}</span>`
    ).join('');
  }

  // Finalised lines (the persistent chat log at the bottom of the overlay).
  static _subHistory = [];
  // In-flight (interim) lines keyed by charId, replaced as the speaker
  // talks. They commit to history when isFinal=true.
  static _subActive = new Map();

  // Crude HTML escape — VN subtitles are written by users and should not
  // be parsed as HTML.
  static _escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  static showSubtitle(name, text, color, charId = null, isFinal = true) {
    const box = document.getElementById('vn-dialogue');
    if (!box) { console.warn('[DD VN] showSubtitle: #vn-dialogue not in DOM'); return; }
    console.log('[DD VN] showSubtitle', { name, text, charId, isFinal });
    box.style.display = 'flex';

    const key = charId ?? '_anon';
    if (isFinal) {
      // Commit current speaker's line to history. Use whatever active
      // interim text we have, falling back to the final transcript.
      const entry = { name, text, color, charId, t: Date.now() };
      this._subHistory.push(entry);
      this._subActive.delete(key);
      // Cap to avoid unbounded growth across a long session.
      if (this._subHistory.length > 300) this._subHistory.shift();
    } else {
      this._subActive.set(key, { name, text, color, charId });
    }

    this._renderSubtitles();
    _state.dialogue._subtitleActive = true;
  }

  static _renderSubtitles() {
    const container = document.getElementById('vn-subtitles-container');
    if (!container) return;
    const escape = this._escapeHtml;
    const historyHtml = this._subHistory.map(s => `
      <div class="vn-subtitle-item vn-sub-final">
        <span class="vn-sub-name" style="color:${escape(s.color || '#ffe066')}">${escape(s.name)}:</span>
        <span class="vn-sub-text">${escape(s.text)}</span>
      </div>`).join('');
    const activeHtml = [...this._subActive.values()].map(s => `
      <div class="vn-subtitle-item vn-sub-live">
        <span class="vn-sub-name" style="color:${escape(s.color || '#ffe066')}">${escape(s.name)}:</span>
        <span class="vn-sub-text">${escape(s.text)}…</span>
      </div>`).join('');
    container.innerHTML = historyHtml + activeHtml;
    const hasAny = this._subHistory.length || this._subActive.size;
    container.style.display = hasAny ? 'flex' : 'none';
    // Keep newest line in view as new ones arrive.
    container.scrollTop = container.scrollHeight;
  }

  static hideAllSubtitles() {
    // Manual clear — called by explicit overlay-close paths. The chat log
    // is otherwise persistent within a session.
    this._subHistory = [];
    this._subActive.clear();
    const container = document.getElementById('vn-subtitles-container');
    if (container) { container.innerHTML = ''; container.style.display = 'none'; }
    _state.dialogue._subtitleActive = false;
    if (!_state.dialogue.visible) {
      const box = document.getElementById('vn-dialogue');
      if (box) box.style.display = 'none';
    }
  }

  static hideSubtitleByPlayer(charId) {
    const key = charId ?? '_anon';
    this._subActive.delete(key);
    this._renderSubtitles();
  }

  static _renderDialogue(d) {
    const box = document.getElementById('vn-dialogue');
    if (!box) return;

    // The dialogue/chat box is always visible while the VN overlay is open
    // — it hosts the inline chat input which is the user's manual fallback
    // when speech recognition is unavailable.
    box.style.display = _state.open ? 'flex' : 'none';

    const speaker = document.getElementById('vn-speaker');
    const text = document.getElementById('vn-text');
    if (d.visible && (d.speakerName || d.text)) {
      if (speaker) { speaker.textContent = d.speakerName || ''; speaker.style.color = d.speakerColor || '#ffe066'; }
      if (text) text.innerHTML = d.text || '';
    } else {
      if (speaker) speaker.textContent = '';
      if (text) text.textContent = '';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TAG UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/** Render a tag-chip input row (read+write). dataKey = HTML attr to prefix events. */
function renderTagChips(tags = [], editable = true) {
  const chips = (tags || []).map(t =>
    `<span class="vn-tag-chip">${t}${editable ? `<button class="vn-tag-chip-del" data-tag="${t}" tabindex="-1">×</button>` : ''}</span>`
  ).join('');
  if (!editable) return `<div class="vn-tag-chips-display">${chips || '<span class="vn-tag-empty">—</span>'}</div>`;
  return `
    <div class="vn-tag-input-wrap">
      <div class="vn-tag-chips-row">${chips}</div>
      <input class="vn-tag-inp dd-input" type="text" placeholder="тег + Enter" autocomplete="off"/>
    </div>`;
}

/** Render a compact tag-filter bar given all available tags and active set. id prefix for event binding. */
function renderTagFilterBar(allTags, activeTags, idPrefix) {
  if (!allTags.length) return '';
  return `
    <div class="vn-tag-filter-bar" data-tag-filter="${idPrefix}">
      ${allTags.map(t => `
        <button class="vn-tag-filter-chip ${activeTags.has(t) ? 'active' : ''}" data-filter-tag="${t}">${t}</button>
      `).join('')}
    </div>`;
}

/** Collect all unique tags from an array of objects */
function collectTags(items) {
  const set = new Set();
  for (const it of items) for (const t of (it.tags || [])) set.add(t);
  return [...set].sort();
}

/** Returns true if item matches active tag filter (all selected tags must be present) */
function matchesTags(item, activeTags) {
  if (!activeTags.size) return true;
  const itemTags = new Set(item.tags || []);
  for (const t of activeTags) if (!itemTags.has(t)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GM LEFT BAR
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNGMBar {
  static _charsOpen = false;
  static _bgsOpen = false;
  static _presetsOpen = false;
  static _controlsOpen = false;
  static _charQuery = '';
  static _bgQuery = '';
  static _activeCharTags = new Set(); // currently selected tag filters for chars
  static _activeBgTags   = new Set(); // currently selected tag filters for bgs
  static _presetsOpen = false;
  static _controlsOpen = false;
  static _charQuery = '';
  static _bgQuery = '';
  static _bound = false;

  static get _gmCharId() { return DDVNPanel._instance?._gmCharId ?? this.__gmCharId ?? null; }
  static set _gmCharId(v) {
    this.__gmCharId = v;
    if (DDVNPanel._instance) DDVNPanel._instance._gmCharId = v;
  }

  static update(state) {
    const bar = document.getElementById('vn-gm-left-bar');
    if (!bar) return;

    if (!state.open || !game.user?.isGM) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';

    const chars = state.chars || [];
    const allBg = DDVNPresets.getAllBg();
    const scenePresets = DDVNPresets.listScenes();
    const charPresets = DDVNPresets.listChars();

    // Preserve scroll position across rebuilds.
    // We store the saved position directly on the stable `bar` DOM node so it
    // survives multiple innerHTML replacements without any closure aliasing issues.
    const savedScrollTop = bar._savedScrollTop ?? 0;
    const openDetails = new Set();
    bar.querySelectorAll('details.vn-gml-bg-dropdown').forEach((d, i) => {
      if (d.open) openDetails.add(i);
    });

    bar.innerHTML = `
      <div class="vn-gml-inner">
        
        <!-- Mouse Controls Section -->
        <div class="vn-gml-section vn-gml-controls-section">
          <button class="vn-gml-toggle-btn ${this._controlsOpen ? 'open' : ''}" id="vn-gml-controls-btn">
            <i class="fas fa-mouse-pointer"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.mouseControl')}
            <i class="fas fa-chevron-${this._controlsOpen ? 'up' : 'down'} vn-gml-chev"></i>
          </button>
          <div class="vn-gml-dropdown ${this._controlsOpen ? 'open' : ''}" id="vn-gml-controls-drop">
            <div class="vn-gml-control-item">
              <label class="vn-gml-checkbox-label">
                <input type="checkbox" id="vn-mouse-control" ${state.mouseControl ? 'checked' : ''}/>
                <span><i class="fas fa-hand-pointer"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.mouseControl')}</span>
              </label>
            </div>
            <div class="vn-gml-control-item">
              <label class="vn-gml-checkbox-label">
                <input type="checkbox" id="vn-depth-mode" ${state.depthMode ? 'checked' : ''} ${!state.mouseControl ? 'disabled' : ''}/>
                <span><i class="fas fa-layer-group"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.depthMode')}</span>
              </label>
            </div>
            <div class="vn-gml-control-item vn-gml-depth-slider ${state.depthMode && state.mouseControl ? '' : 'dd-hidden'}" id="vn-depth-slider-wrap">
              <label class="vn-gml-slider-label">
                <span><i class="fas fa-expand-arrows-alt"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.depthScaleMultiplier')}</span>
                <input type="range" id="vn-depth-scale-mult" value="${state.depthScaleMultiplier || 1}" min="0.1" max="4" step="0.1" style="flex:1;min-width:50px"/>
                <span class="vn-slider-val">${state.depthScaleMultiplier || 1}x</span>
              </label>
            </div>
            <div class="vn-gml-control-item vn-gml-depth-slider ${state.depthMode && state.mouseControl ? '' : 'dd-hidden'}" id="vn-depth-y-slider-wrap">
              <label class="vn-gml-slider-label">
                <span><i class="fas fa-arrows-alt-v"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.depthYMultiplier')}</span>
                <input type="range" id="vn-depth-y-mult" value="${state.depthYMultiplier || 1}" min="0.1" max="4" step="0.1" style="flex:1;min-width:50px"/>
                <span class="vn-slider-val">${state.depthYMultiplier || 1}x</span>
              </label>
            </div>
            <div class="vn-gml-control-item ${state.depthMode && state.mouseControl ? '' : 'dd-hidden'}" id="vn-horizon-wrap">
              <label class="vn-gml-checkbox-label">
                <input type="checkbox" id="vn-horizon-line" ${state.horizonLine ? 'checked' : ''}/>
                <span><i class="fas fa-minus"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.horizonLine')}</span>
              </label>
              <div class="vn-gml-hint">${game.i18n.localize('DRAMADIRECTOR.vn.gml.horizonLineHint')}</div>
              <div id="vn-horizon-y-wrap" style="display:${state.horizonLine ? '' : 'none'};margin-top:4px;">
                <label class="vn-gml-slider-label" style="font-size:11px;">
                  <span style="white-space:nowrap;min-width:90px;"><i class="fas fa-arrows-alt-v"></i> Горизонт Y</span>
                  <input type="range" id="vn-horizon-y-slider" value="${state.horizonY ?? 30}" min="0" max="90" step="1" style="flex:1;min-width:50px"/>
                  <span class="vn-slider-val" id="vn-horizon-y-val">${state.horizonY ?? 30}%</span>
                </label>
              </div>
            </div>
            <div class="vn-gml-control-item">
              <label class="vn-gml-checkbox-label">
                <input type="checkbox" id="vn-player-control" ${state.playerControl ? 'checked' : ''}/>
                <span><i class="fas fa-users"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.playerControl')}</span>
              </label>
              <div class="vn-gml-hint">${game.i18n.localize('DRAMADIRECTOR.vn.gml.playerControlHint')}</div>
            </div>
            <div class="vn-gml-control-item ${state.horizonLine && state.mouseControl ? '' : 'dd-hidden'}" id="vn-hide-horizon-wrap">
              <label class="vn-gml-checkbox-label">
                <input type="checkbox" id="vn-hide-horizon-line" ${state.hideHorizonLine ? 'checked' : ''}/>
                <span><i class="fas fa-eye-slash"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.hideHorizonLine')}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- GM Voice -->
        <div class="vn-gml-section vn-gml-voice">
          <span class="vn-gml-label"><i class="fas fa-comment-alt"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.speaking')}</span>
          <select id="vn-gml-voice-sel" class="vn-gml-select">
            <option value="">${game.i18n.localize('DRAMADIRECTOR.vn.gml.noOne')}</option>
            ${chars.map(c => `<option value="${c.id}" ${this._gmCharId === c.id ? 'selected' : ''}>${c.name || game.i18n.localize('DRAMADIRECTOR.vn.gml.noName')}</option>`).join('')}
          </select>
        </div>

        <!-- Actors -->
        <div class="vn-gml-section">
          <button class="vn-gml-toggle-btn ${this._charsOpen ? 'open' : ''}" id="vn-gml-chars-btn">
            <i class="fas fa-users"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.actors')}
            <span class="vn-gml-count">${chars.length}</span>
            <i class="fas fa-chevron-${this._charsOpen ? 'up' : 'down'} vn-gml-chev"></i>
          </button>
          <div class="vn-gml-dropdown ${this._charsOpen ? 'open' : ''}" id="vn-gml-chars-drop">
            <div class="vn-gml-search-row">
              <input type="text" class="vn-gml-search" id="vn-gml-char-search"
                placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.gml.search')}" value="${this._charQuery}"/>
            </div>
            <div class="vn-gml-list" id="vn-gml-char-list">
              ${this._renderCharList(chars, this._charQuery)}
            </div>
          </div>
        </div>

        <!-- Backgrounds -->
        <div class="vn-gml-section">
          <button class="vn-gml-toggle-btn ${this._bgsOpen ? 'open' : ''}" id="vn-gml-bgs-btn">
            <i class="fas fa-image"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.backgrounds')}
            <i class="fas fa-chevron-${this._bgsOpen ? 'up' : 'down'} vn-gml-chev"></i>
          </button>
          <div class="vn-gml-dropdown ${this._bgsOpen ? 'open' : ''}" id="vn-gml-bgs-drop">
            <div class="vn-gml-search-row">
              <input type="text" class="vn-gml-search" id="vn-gml-bg-search"
                placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.gml.search')}" value="${this._bgQuery}"/>
            </div>
            <div class="vn-gml-list" id="vn-gml-bg-list">
              ${this._renderBgList(allBg, state.background, this._bgQuery)}
            </div>
          </div>
        </div>

        <!-- Presets -->
        <div class="vn-gml-section">
          <button class="vn-gml-toggle-btn ${this._presetsOpen ? 'open' : ''}" id="vn-gml-presets-btn">
            <i class="fas fa-bookmark"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.presets')}
            <i class="fas fa-chevron-${this._presetsOpen ? 'up' : 'down'} vn-gml-chev"></i>
          </button>
          <div class="vn-gml-dropdown ${this._presetsOpen ? 'open' : ''}" id="vn-gml-presets-drop">
            <div class="vn-gml-preset-section">
              <div class="vn-gml-preset-header"><i class="fas fa-film"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.scenes')}</div>
              <div class="vn-gml-preset-list">
                ${this._renderScenePresets(scenePresets)}
              </div>
            </div>
            <div class="vn-gml-preset-section">
              <div class="vn-gml-preset-header"><i class="fas fa-users"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.rosters')}</div>
              <div class="vn-gml-preset-list">
                ${this._renderCharPresets(charPresets)}
              </div>
            </div>
            <div class="vn-gml-preset-section">
              <div class="vn-gml-preset-header"><i class="fas fa-layer-group"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.layerPresets')}</div>
              <div class="vn-gml-preset-list">
                ${this._renderLayerPresets(DDVNPresets.listLayers())}
              </div>
            </div>
            <div class="vn-gml-preset-section">
              <div class="vn-gml-preset-header"><i class="fas fa-hand-pointer"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.gml.interactivePresets')}</div>
              <div class="vn-gml-preset-list">
                ${this._renderIimgPresets(DDVNPresets.listIimgs())}
              </div>
            </div>
          </div>
        </div>

      </div>`;

    this._bindEvents(bar, state, allBg);

    // ── Restore scroll and <details> open state ────────────────────────────

    // Attach scroll listener ONCE on the stable `bar` via event capture delegation.
    // Uses bar._savedScrollTop so the value survives innerHTML replacements.
    if (!bar._scrollListenerBound) {
      bar._scrollListenerBound = true;
      bar.addEventListener('scroll', () => {
        // Don't record while a restore is actively fighting async resets.
        if (!bar._scrollRestoreTimer) {
          const inner = bar.querySelector('.vn-gml-inner');
          if (inner) bar._savedScrollTop = inner.scrollTop;
        }
      }, { capture: true, passive: true });
    }

    // Restore: cancel any in-flight restore from a prior update(), then re-arm.
    // CRITICAL: always query bar.querySelector('.vn-gml-inner') INSIDE the interval —
    // never use a closure variable, because bar.innerHTML may be replaced again by
    // async Foundry renders, making any captured reference point to a detached node.
    clearInterval(bar._scrollRestoreTimer);
    bar._scrollRestoreTimer = null;
    if (savedScrollTop > 0) {
      let attempts = 0;
      bar._scrollRestoreTimer = setInterval(() => {
        const inner = bar.querySelector('.vn-gml-inner');
        if (inner) inner.scrollTop = savedScrollTop;
        attempts++;
        // Stop after 20 ticks (~400ms) — enough to outlast any async Foundry render.
        if (attempts >= 20) {
          clearInterval(bar._scrollRestoreTimer);
          bar._scrollRestoreTimer = null;
        }
      }, 20);
    }
    if (openDetails.size) {
      bar.querySelectorAll('details.vn-gml-bg-dropdown').forEach((d, i) => {
        if (openDetails.has(i)) d.open = true;
      });
    }
  }

  static _renderCharList(chars, query) {
    const q = query.toLowerCase().trim();
    const active = this._activeCharTags;

    const allTags = collectTags(chars);
    const filterBar = renderTagFilterBar(allTags, active, 'char');

    const filtered = chars.filter(c => {
      const nameMatch = !q || (c.name || '').toLowerCase().includes(q) || (c.title || '').toLowerCase().includes(q);
      return nameMatch && matchesTags(c, active);
    });

    if (!filtered.length) return filterBar + `<div class="vn-gml-empty">${game.i18n.localize('DRAMADIRECTOR.notifications.noChars')}</div>`;

    const players = (game.users?.contents || []).filter(u => !u.isGM);

    return filterBar + filtered.map(c => {
      const isActive  = !!c.active;
      const isVisible = c.visible !== false;
      const isLocked  = c.locked === true;
      const sideIcon  = c.side === 'left' ? '◀' : c.side === 'center' ? '◆' : '▶';
      const imgHtml   = c.img
        ? `<img src="${c.img}" class="vn-gml-char-thumb-img"/>`
        : `<i class="fas fa-user vn-gml-char-thumb-icon"></i>`;

      const playerOpts = players.map(u =>
        `<option value="${u.id}" ${c.playerId === u.id ? 'selected' : ''}>${u.name}</option>`
      ).join('');

      const sideLabel = c.side === 'left'   ? game.i18n.localize('DRAMADIRECTOR.vn.gml.left')   :
                        c.side === 'center' ? game.i18n.localize('DRAMADIRECTOR.vn.gml.center') :
                                              game.i18n.localize('DRAMADIRECTOR.vn.gml.right');

      const tagChips = (c.tags || []).map(t => `<span class="vn-gml-tag-chip">${t}</span>`).join('');

      return `
        <div class="vn-gml-char-item ${isActive ? 'gml-active' : ''} ${isVisible ? '' : 'gml-hidden-char'} ${isLocked ? 'gml-locked' : ''}"
             data-char-id="${c.id}" title="${game.i18n.localize('DRAMADIRECTOR.vn.gml.charTooltip')}">
          <div class="vn-gml-char-thumb">${imgHtml}</div>
          <div class="vn-gml-char-info">
            <span class="vn-gml-char-name" style="color:${c.nameColor || '#ffe066'}">
              ${c.name || game.i18n.localize('DRAMADIRECTOR.vn.gml.noName')}
              ${isLocked ? '<i class="fas fa-lock vn-lock-icon"></i>' : ''}
            </span>
            ${tagChips ? `<div class="vn-gml-tag-chips-row">${tagChips}</div>` : ''}
            <div class="vn-gml-char-player-row">
              <span class="vn-gml-char-meta">${sideIcon} ${sideLabel}${c.title ? ' · ' + c.title : ''}</span>
              <select class="vn-gml-player-sel" data-player-for="${c.id}" title="${game.i18n.localize('DRAMADIRECTOR.vn.gml.assignPlayer')}">
                <option value="">${game.i18n.localize('DRAMADIRECTOR.vn.gml.playerNone')}</option>
                ${playerOpts}
              </select>
            </div>
          </div>
          <div class="vn-gml-char-btns">
            <button class="vn-gml-emotion-btn ${c.activeEmotion ? 'has-emotion' : ''}" data-emotion-id="${c.id}" title="${game.i18n.localize('DRAMADIRECTOR.vn.emotions') || 'Эмоции'}">
              <i class="fas fa-theater-masks"></i>
              ${c.activeEmotion ? `<span class="vn-gml-emo-badge"></span>` : ''}
            </button>
            <button class="vn-gml-active-btn ${isActive ? 'on' : ''}" data-activate-id="${c.id}" title="${game.i18n.localize('DRAMADIRECTOR.vn.charActivate')}"><i class="fas fa-lightbulb"></i></button>
          </div>
        </div>`;
    }).join('');
  }

  static _renderBgList(allBg, currentBg, query) {
    const q = query.toLowerCase().trim();
    const active = this._activeBgTags;

    // Collect all tags across all bg variants
    const allVariants = allBg.flatMap(g => g.variants || []);
    const allTags = collectTags(allVariants);
    const filterBar = renderTagFilterBar(allTags, active, 'bg');

    let html = filterBar;
    for (const group of allBg) {
      const variants = (group.variants || []).filter(v => {
        const nameMatch = !q || (v.name || '').toLowerCase().includes(q) || (group.name || '').toLowerCase().includes(q);
        return nameMatch && matchesTags(v, active);
      });
      if (!variants.length) continue;

      const expanded = (q || active.size) ? 'open' : '';
      html += `<details class="vn-gml-bg-dropdown" ${expanded}>
        <summary class="vn-gml-bg-group-name">
          <i class="fas fa-chevron-right vn-gml-bg-chev"></i>
          <i class="fas fa-folder vn-gml-bg-folder-icon"></i>
          <span>${group.name}</span>
          <span class="vn-gml-bg-count">${variants.length}</span>
        </summary>
        <div class="vn-gml-bg-items">`;
      for (const v of variants) {
        const isVid = /\.(webm|mp4|ogv)(?:[?#]|$)/i.test(v.src);
        const icon  = isVid ? 'fa-film' : 'fa-image';
        const active2 = v.src === currentBg ? 'gml-bg-active' : '';
        html += `
          <div class="vn-gml-bg-item ${active2}" data-bg-src="${v.src}" title="${v.name}">
            <i class="fas ${icon} vn-gml-bg-icon"></i>
            <span class="vn-gml-bg-name">${v.name}</span>
          </div>`;
      }
      html += `</div></details>`;
    }
    return html || `<div class="vn-gml-empty">${game.i18n.localize("DRAMADIRECTOR.notifications.nothingFound")}</div>`;
  }

  static _renderScenePresets(scenePresets) {
    if (!scenePresets.length) return `<div class="vn-gml-empty">${game.i18n.localize("DRAMADIRECTOR.notifications.noSavedScenes")}</div>`;
    return scenePresets.map(name => `
      <div class="vn-gml-preset-item" data-scene-preset="${name}" title="${game.i18n.localize('DRAMADIRECTOR.vn.gml.loadScene')}">
        <i class="fas fa-film vn-gml-preset-icon"></i>
        <span class="vn-gml-preset-name">${name}</span>
        <i class="fas fa-play vn-gml-preset-load"></i>
      </div>
    `).join('');
  }

  static _renderCharPresets(charPresets) {
    if (!charPresets.length) return `<div class="vn-gml-empty">${game.i18n.localize("DRAMADIRECTOR.notifications.noSavedRosters")}</div>`;
    return charPresets.map(name => `
      <div class="vn-gml-preset-item" data-char-preset="${name}" title="${game.i18n.localize('DRAMADIRECTOR.vn.gml.loadRoster')}">
        <i class="fas fa-users vn-gml-preset-icon"></i>
        <span class="vn-gml-preset-name">${name}</span>
        <i class="fas fa-play vn-gml-preset-load"></i>
      </div>
    `).join('');
  }

  static _renderLayerPresets(layerPresets) {
    if (!layerPresets.length) return `<div class="vn-gml-empty">${game.i18n.localize("DRAMADIRECTOR.notifications.noSavedLayers")}</div>`;
    return layerPresets.map(name => `
      <div class="vn-gml-preset-item" data-layer-preset="${name}" title="${game.i18n.localize('DRAMADIRECTOR.vn.gml.loadLayers')}">
        <i class="fas fa-layer-group vn-gml-preset-icon"></i>
        <span class="vn-gml-preset-name">${name}</span>
        <i class="fas fa-play vn-gml-preset-load"></i>
      </div>
    `).join('');
  }

  static _renderIimgPresets(iimgPresets) {
    if (!iimgPresets.length) return `<div class="vn-gml-empty">${game.i18n.localize("DRAMADIRECTOR.notifications.noSavedInteractive")}</div>`;
    return iimgPresets.map(name => `
      <div class="vn-gml-preset-item" data-iimg-preset="${name}" title="${game.i18n.localize('DRAMADIRECTOR.vn.gml.loadInteractive')}">
        <i class="fas fa-hand-pointer vn-gml-preset-icon"></i>
        <span class="vn-gml-preset-name">${name}</span>
        <i class="fas fa-play vn-gml-preset-load"></i>
      </div>
    `).join('');
  }

  static _bindEvents(bar, state, allBg) {
    // Controls toggle
    bar.querySelector('#vn-gml-controls-btn')?.addEventListener('click', () => {
      this._controlsOpen = !this._controlsOpen;
      this.update(_state);
    });

    // Mouse control
    bar.querySelector('#vn-mouse-control')?.addEventListener('change', (e) => {
      _state.mouseControl = e.target.checked;
      const depthCheckbox = bar.querySelector('#vn-depth-mode');
      if (depthCheckbox) depthCheckbox.disabled = !e.target.checked;
      // Показать/скрыть все элементы глубины
      const sliderWrap = bar.querySelector('#vn-depth-slider-wrap');
      const ySliderWrap = bar.querySelector('#vn-depth-y-slider-wrap');
      const horizonWrap = bar.querySelector('#vn-horizon-wrap');
      if (sliderWrap) sliderWrap.classList.toggle('dd-hidden', !_state.depthMode || !_state.mouseControl);
      if (ySliderWrap) ySliderWrap.classList.toggle('dd-hidden', !_state.depthMode || !_state.mouseControl);
      if (horizonWrap) horizonWrap.classList.toggle('dd-hidden', !_state.depthMode || !_state.mouseControl);
      DDVNManager.broadcast();
    });

    // Depth mode
    bar.querySelector('#vn-depth-mode')?.addEventListener('change', (e) => {
      _state.depthMode = e.target.checked;
      // Показать/скрыть все элементы глубины
      const sliderWrap = bar.querySelector('#vn-depth-slider-wrap');
      const ySliderWrap = bar.querySelector('#vn-depth-y-slider-wrap');
      const horizonWrap = bar.querySelector('#vn-horizon-wrap');
      if (sliderWrap) sliderWrap.classList.toggle('dd-hidden', !_state.depthMode || !_state.mouseControl);
      if (ySliderWrap) ySliderWrap.classList.toggle('dd-hidden', !_state.depthMode || !_state.mouseControl);
      if (horizonWrap) horizonWrap.classList.toggle('dd-hidden', !_state.depthMode || !_state.mouseControl);
      // При включении — снимок baseScale и пересчёт перспективы
      if (_state.depthMode) DDVNManager._snapshotAndRecalcDepth();
      DDVNManager.broadcast();
    });

    // Depth scale multiplier
    bar.querySelector('#vn-depth-scale-mult')?.addEventListener('input', (e) => {
      _state.depthScaleMultiplier = parseFloat(e.target.value);
      const valSpan = bar.querySelector('#vn-depth-slider-wrap .vn-slider-val');
      if (valSpan) valSpan.textContent = _state.depthScaleMultiplier + 'x';
      DDVNManager.broadcast();
    });

    // Depth Y multiplier
    bar.querySelector('#vn-depth-y-mult')?.addEventListener('input', (e) => {
      _state.depthYMultiplier = parseFloat(e.target.value);
      const valSpan = bar.querySelector('#vn-depth-y-slider-wrap .vn-slider-val');
      if (valSpan) valSpan.textContent = _state.depthYMultiplier + 'x';
      DDVNManager.broadcast();
    });

    // Horizon line
    bar.querySelector('#vn-horizon-line')?.addEventListener('change', (e) => {
      _state.horizonLine = e.target.checked;
      const yWrap = bar.querySelector('#vn-horizon-y-wrap');
      if (yWrap) yWrap.style.display = e.target.checked ? '' : 'none';
      const hideWrap = bar.querySelector('#vn-hide-horizon-wrap');
      if (hideWrap) hideWrap.classList.toggle('dd-hidden', !e.target.checked || !_state.mouseControl);
      if (e.target.checked) {
        DDVNManager.initHorizonLine();
      } else {
        DDVNManager.clearHorizonLine();
      }
      DDVNManager.broadcast();
    });

    bar.querySelector('#vn-horizon-y-slider')?.addEventListener('input', (e) => {
      const pct = parseFloat(e.target.value);
      _state.horizonY = pct;
      const valSpan = bar.querySelector('#vn-horizon-y-val');
      if (valSpan) valSpan.textContent = pct + '%';
      if (_state.horizonLine) {
        DDVNManager.initHorizonLine();
        DDVNManager._updateHorizonIndicator();
      }
    });

    // Player control
    bar.querySelector('#vn-player-control')?.addEventListener('change', (e) => {
      _state.playerControl = e.target.checked;
      DDVNManager.broadcast();
    });

    // Infinite-roster toggle removed — infinite is now the only mode.

    // Hide horizon line visual
    bar.querySelector('#vn-hide-horizon-line')?.addEventListener('change', (e) => {
      _state.hideHorizonLine = e.target.checked;
      DDVNManager._updateHorizonIndicator();
      DDVNManager.broadcast();
    });

    // GM Voice
    bar.querySelector('#vn-gml-voice-sel')?.addEventListener('change', e => {
      this._gmCharId = e.target.value || null;
    });

    // Actors accordion
    bar.querySelector('#vn-gml-chars-btn')?.addEventListener('click', () => {
      this._charsOpen = !this._charsOpen;
      this.update(_state);
    });

    // Backgrounds accordion
    bar.querySelector('#vn-gml-bgs-btn')?.addEventListener('click', () => {
      this._bgsOpen = !this._bgsOpen;
      this.update(_state);
    });

    // Presets accordion
    bar.querySelector('#vn-gml-presets-btn')?.addEventListener('click', () => {
      this._presetsOpen = !this._presetsOpen;
      this.update(_state);
    });

    // Search
    bar.querySelector('#vn-gml-char-search')?.addEventListener('input', e => {
      this._charQuery = e.target.value;
      const list = bar.querySelector('#vn-gml-char-list');
      if (list) list.innerHTML = this._renderCharList(state.chars || [], this._charQuery);
      this._bindCharItemEvents(bar, state.chars || []);
      this._bindTagFilterEvents(bar, state, allBg);
    });

    bar.querySelector('#vn-gml-bg-search')?.addEventListener('input', e => {
      this._bgQuery = e.target.value;
      const list = bar.querySelector('#vn-gml-bg-list');
      if (list) list.innerHTML = this._renderBgList(allBg, state.background, this._bgQuery);
      this._bindBgItemEvents(bar);
      this._bindTagFilterEvents(bar, state, allBg);
    });

    this._bindCharItemEvents(bar, state.chars || []);
    this._bindBgItemEvents(bar);
    this._bindPresetEvents(bar);
    this._bindTagFilterEvents(bar, state, allBg);
  }

  static _bindTagFilterEvents(bar, state, allBg) {
    // Char tag filters
    bar.querySelectorAll('[data-tag-filter="char"] [data-filter-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.filterTag;
        if (this._activeCharTags.has(t)) this._activeCharTags.delete(t);
        else this._activeCharTags.add(t);
        const list = bar.querySelector('#vn-gml-char-list');
        if (list) list.innerHTML = this._renderCharList(state.chars || [], this._charQuery);
        this._bindCharItemEvents(bar, state.chars || []);
        this._bindTagFilterEvents(bar, state, allBg);
      });
    });
    // Bg tag filters
    bar.querySelectorAll('[data-tag-filter="bg"] [data-filter-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.filterTag;
        if (this._activeBgTags.has(t)) this._activeBgTags.delete(t);
        else this._activeBgTags.add(t);
        const list = bar.querySelector('#vn-gml-bg-list');
        if (list) list.innerHTML = this._renderBgList(allBg, state.background, this._bgQuery);
        this._bindBgItemEvents(bar);
        this._bindTagFilterEvents(bar, state, allBg);
      });
    });
  }

  static _bindCharItemEvents(bar, chars) {
    bar.querySelectorAll('.vn-gml-char-item').forEach(item => {
      const fresh = item.cloneNode(true);
      item.replaceWith(fresh);
    });

    bar.querySelectorAll('.vn-gml-char-item').forEach(item => {
      const id = item.dataset.charId;

      item.addEventListener('click', e => {
        if (e.target.closest('[data-activate-id]')) return;
        if (e.target.closest('.vn-gml-player-sel')) return;
        const c = _state.chars.find(c => c.id === id);
        if (!c) return;
        c.visible = c.visible === false ? true : false;
        this._syncCharToPanel(id);
        DDVNManager.broadcast();
      });

      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        const c = _state.chars.find(c => c.id === id);
        if (!c) return;
        const sides = ['left', 'center', 'right'];
        const currentIdx = sides.indexOf(c.side);
        c.side = sides[(currentIdx + 1) % sides.length];
        let l = 0, cCnt = 0, r = 0;
        _state.chars.forEach(ch => { 
          if (ch.side === 'left') ch.slot = l++;
          else if (ch.side === 'center') ch.slot = cCnt++;
          else ch.slot = r++;
        });
        this._syncCharToPanel(id);
        DDVNManager.broadcast();
      });
    });

    bar.querySelectorAll('.vn-gml-player-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        e.stopPropagation();
        const id = sel.dataset.playerFor;
        const c = _state.chars.find(c => c.id === id);
        if (!c) return;
        // Uniqueness: clear same playerId from other chars
        if (sel.value) {
          _state.chars.forEach(other => {
            if (other.id !== id && other.playerId === sel.value) other.playerId = null;
          });
        }
        c.playerId = sel.value || null;
        this._syncCharToPanel(id);
        DDVNManager.broadcast();
      });
    });

    bar.querySelectorAll('[data-activate-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.activateId;
        const c = _state.chars.find(c => c.id === id);
        if (!c) return;
        c.active = !c.active;
        this._syncCharToPanel(id);
        DDVNManager.broadcast();
      });
    });

    // Emotion button - opens emotion panel
    bar.querySelectorAll('[data-emotion-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.emotionId;
        DDVNEmotionManager.toggleEmotionPanel(id);
      });
    });
  }

  static _syncCharToPanel(charId) {
    if (!DDVNPanel._instance || !charId) return;
    // Sync visibility, active state and playerId from _state → panel local copy
    _state.chars.forEach(sc => {
      const pc = DDVNPanel._instance._chars.find(ch => ch.id === sc.id);
      if (pc) {
        pc.playerId = sc.playerId;
        pc.visible  = sc.visible;
        pc.active   = sc.active;
      }
    });
    // Patch player selects and visibility checkboxes in inspector DOM
    const panelEl = DDVNPanel._instance.element;
    if (panelEl) {
      DDVNPanel._instance._chars.forEach((ch, idx) => {
        const insp = panelEl.querySelector(`.vn-char-inspector-body[data-char-idx="${idx}"]`);
        if (!insp) return;
        const sel = insp.querySelector('.vn-char-player');
        if (sel && sel.value !== (ch.playerId ?? '')) sel.value = ch.playerId ?? '';
        const visCheck = insp.querySelector('.vn-char-visible');
        if (visCheck && visCheck.checked !== (ch.visible !== false)) visCheck.checked = ch.visible !== false;
      });
    }
  }

  static _bindBgItemEvents(bar) {
    // Create shared floating preview element
    let bgPreview = bar.querySelector('#vn-gml-bg-hover-preview');
    if (!bgPreview) {
      bgPreview = document.createElement('div');
      bgPreview.id = 'vn-gml-bg-hover-preview';
      bgPreview.className = 'vn-gml-bg-hover-preview';
      bar.appendChild(bgPreview);
    }

    bar.querySelectorAll('.vn-gml-bg-item').forEach(item => {
      const src = item.dataset.bgSrc;
      const isVid = /\.(webm|mp4|ogv)(?:[?#]|$)/i.test(src || '');

      item.addEventListener('mouseenter', (e) => {
        bgPreview.innerHTML = '';
        if (isVid) {
          const v = document.createElement('video');
          v.src = src; v.muted = true; v.loop = true; v.autoplay = true;
          v.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit';
          bgPreview.appendChild(v);
          v.play().catch(() => {});
        } else {
          bgPreview.style.backgroundImage = `url('${src}')`;
        }
        bgPreview.style.display = 'block';
      });

      item.addEventListener('mouseleave', () => {
        bgPreview.style.display = 'none';
        bgPreview.innerHTML = '';
        bgPreview.style.backgroundImage = '';
      });

      item.addEventListener('click', () => {
        DDVNManager.setBackground(src);
        // Surgically update the bg-path input in the panel (if open) without
        // triggering a full panel re-render, which would cause a second
        // DDVNGMBar.update() call via apply() and reset the GM-bar scroll position.
        const panelInput = DDVNPanel._instance?.element?.querySelector('#vn-bg-path');
        if (panelInput) panelInput.value = src;
      });
    });
  }

  static _bindPresetEvents(bar) {
    bar.querySelectorAll('[data-scene-preset]').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.scenePreset;
        const scene = DDVNPresets.getScene(name);
        if (!scene) {
          ui.notifications?.warn(game.i18n.format("DRAMADIRECTOR.notifications.sceneNotFound", {name}));
          return;
        }
        DDVNManager.applySceneState(scene);
        ui.notifications?.info(game.i18n.format("DRAMADIRECTOR.notifications.sceneLoaded", {name}));
      });
    });

    bar.querySelectorAll('[data-char-preset]').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.charPreset;
        const chars = DDVNPresets.getChars(name);
        if (!chars) {
          ui.notifications?.warn(game.i18n.format("DRAMADIRECTOR.notifications.rosterNotFound", {name}));
          return;
        }
        _state.chars = deepClone(chars);
        if (DDVNPanel._instance) {
          DDVNPanel._instance._chars = deepClone(_state.chars);
          DDVNPanel._instance.render();
        }
        DDVNManager.broadcast();
        DDVNOverlay.ensureOpen();
        ui.notifications?.info(game.i18n.format("DRAMADIRECTOR.notifications.rosterLoaded", {name, count: chars.length}));
      });
    });

    // Layer presets
    bar.querySelectorAll('[data-layer-preset]').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.layerPreset;
        const snapshot = DDVNPresets.getLayers(name);
        if (!snapshot) {
          ui.notifications?.warn(game.i18n.format("DRAMADIRECTOR.notifications.layerPresetNotFound", {name}));
          return;
        }
        // Apply transform snapshot to master list — objects not in snapshot unchanged
        _state.layers = DDVNPresets.applyTransformSnapshot(_state.layers, snapshot);
        if (DDVNPanel._instance) {
          DDVNPanel._instance._layers = deepClone(_state.layers);
          DDVNPanel._instance.render();
        }
        DDVNManager.broadcast();
        DDVNOverlay.ensureOpen();
        ui.notifications?.info(game.i18n.format("DRAMADIRECTOR.notifications.layerPresetLoaded", {name, count: snapshot.length}));
      });
    });

    // Interactive image presets
    bar.querySelectorAll('[data-iimg-preset]').forEach(item => {
      item.addEventListener('click', () => {
        const name = item.dataset.iimgPreset;
        const snapshot = DDVNPresets.getIimgs(name);
        if (!snapshot) {
          ui.notifications?.warn(game.i18n.format("DRAMADIRECTOR.notifications.iimgPresetNotFound", {name}));
          return;
        }
        _state.interactiveImages = DDVNPresets.applyTransformSnapshot(_state.interactiveImages, snapshot);
        if (DDVNPanel._instance) {
          DDVNPanel._instance._interactiveImages = deepClone(_state.interactiveImages);
          DDVNPanel._instance.render();
        }
        DDVNManager.broadcast();
        DDVNOverlay.ensureOpen();
        ui.notifications?.info(game.i18n.format("DRAMADIRECTOR.notifications.iimgPresetLoaded", {name, count: snapshot.length}));
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MIC
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNMic {
  static _localSpeech = null;
  static _speechGeneration = 0;
  static _starting = false;
  static _stream = null;
  static _ctx = null;
  static _analyser = null;
  static _recognition = null;
  static _active = false;
  static _vadTimer = null;
  static _speaking = false;
  static threshold = 18;
  static lang = 'ru-RU';

  static async start() {
    if (this._active || this._starting) return;
    // Fresh mic activation — give SR a clean slate; user can re-enable
    // after fixing a previously-broken network/STT path.
    this._srNetworkFails = 0;
    this._srGaveUp = false;
    // Preflight: browsers expose mediaDevices only in secure contexts (https or localhost).
    // Without this check the failure mode is a confusing TypeError on the next line.
    if (!navigator?.mediaDevices?.getUserMedia) {
      const reason = window.isSecureContext
        ? 'mediaDevices API not available in this browser'
        : 'page is not in a secure context (requires HTTPS or localhost)';
      console.error('[DD VN] mic unavailable —', reason);
      ui.notifications?.error(game.i18n.format('DRAMADIRECTOR.notifications.micNoAccess', { error: reason }));
      return;
    }
    try {
      this._starting = true;
      const generation = ++this._speechGeneration;
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this._speechGeneration) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; return; }
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Chrome auto-suspends an AudioContext that is created outside of a user gesture.
      // resume() is async but doesn't need to be awaited for VAD to start; we fire-and-log.
      if (this._ctx.state === 'suspended') this._ctx.resume().catch(err => console.warn('[DD VN] AudioContext.resume failed', err));
      this._analyser = this._ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._ctx.createMediaStreamSource(this._stream).connect(this._analyser);
      this._active = true;
      this._startVAD();
      this._startSpeech();
      DDVNOverlay.updateMicIndicator();
      console.log('[DD VN] microphone started');
    } catch (e) {
      this.stop();
      console.error('[DD VN] mic start failed', e);
      const msg = e?.name === 'NotAllowedError'
        ? game.i18n.localize('DRAMADIRECTOR.notifications.micDenied')
        : game.i18n.format('DRAMADIRECTOR.notifications.micNoAccess', { error: e?.message ?? String(e) });
      ui.notifications?.error(msg);
    } finally { this._starting = false; }
  }

  static stop() {
    this._active = false;
    ++this._speechGeneration;
    this._localSpeech?.stop(); this._localSpeech = null;
    clearInterval(this._vadTimer);
    try { this._recognition?.stop(); } catch {}
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close().catch(() => {});
    this._stream = this._ctx = this._analyser = this._recognition = null;
    this._speaking = false;
    DDVNManager.onLocalSpeaking(false);
    // Commit whatever was buffered before turning the mic off so the user
    // doesn't lose the last utterance.
    this._flushUtterance();
    DDVNOverlay.updateMicIndicator();
  }

  static _startVAD() {
    const data = new Uint8Array(this._analyser.frequencyBinCount);
    this._vadTimer = setInterval(() => {
      if (!this._active || !this._analyser) return;
      this._analyser.getByteFrequencyData(data);
      const vol = data.reduce((a, b) => a + b, 0) / data.length;
      const isSpeaking = vol > this.threshold;
      if (isSpeaking !== this._speaking) {
        this._speaking = isSpeaking;
        DDVNManager.onLocalSpeaking(isSpeaking);
      }
    }, 80);
  }

  // Track consecutive `network` errors so we stop spamming auto-restart and
  // user notifications when the browser can't reach Google's STT servers.
  static _srNetworkFails = 0;
  static _srGaveUp = false;

  // Speech buffer: Chrome's continuous-mode webkitSpeechRecognition finalises
  // each *word* as its own result (especially on ru-RU), which means a literal
  // SR-finalised path floods the chat with single-word lines. Instead, we
  // accumulate finalised fragments in this buffer and only commit one chat
  // line after the user pauses long enough that we're confident the
  // utterance is complete.
  static _utteranceBuffer = '';
  static _utteranceTimer = null;
  static UTTERANCE_PAUSE_MS = 1500;

  static _flushUtterance() {
    const text = this._utteranceBuffer.trim();
    this._utteranceBuffer = '';
    if (this._utteranceTimer) { clearTimeout(this._utteranceTimer); this._utteranceTimer = null; }
    if (text) DDVNManager.onSpeechResult(text, true);
  }

  static _startSpeech() {
    if (Whisper.provider === 'off') return;
    if (Whisper.useLocal) {
      if (!Whisper.downloaded && !Whisper.ready) {
        ui.notifications?.warn('Нажмите STT → «Скачать Whisper tiny», затем включите микрофон.'); return;
      }
      const generation = this._speechGeneration;
      const speech = new LocalSpeech(
        text => { if (this._active && generation === this._speechGeneration) DDVNManager.onSpeechResult(text, true); },
        error => ui.notifications?.warn(`Whisper: ${error.message}`), this.lang, () => this.threshold,
      );
      this._localSpeech = speech;
      speech.start(this._ctx, this._stream).catch(error => {
        speech.stop();
        if (this._active && generation === this._speechGeneration) ui.notifications?.error(`Whisper: ${error.message}`);
      });
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[DD VN] SpeechRecognition API is unavailable — subtitles cannot be transcribed in this browser (Firefox does not support webkitSpeechRecognition; use Chrome, Edge, or Opera).');
      ui.notifications?.warn('STT браузера недоступен. Нажмите STT → «Скачать Whisper tiny» для локального распознавания.');
      return;
    }
    if (this._srGaveUp) {
      // STT has been giving us nothing but network errors this session;
      // don't bother starting yet again. User can still type into the chat.
      return;
    }
    console.log('[DD VN] starting SpeechRecognition; lang=', this.lang);
    const rec = new SR();
    // continuous:false gives a *growing* interim transcript per utterance
    // ("раз" → "раз два" → "раз два три"). continuous:true in Chrome/Edge
    // on ru-RU keeps resetting interim to the last 1-2 words, which made
    // the live line look like it was jumping back and forth. We restart
    // the recogniser ourselves in onend to emulate continuous behaviour
    // without that drawback.
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = this.lang;

    rec.onstart  = () => console.log('[DD VN] SR onstart');
    rec.onaudiostart = () => console.log('[DD VN] SR onaudiostart');
    rec.onspeechstart = () => console.log('[DD VN] SR onspeechstart');
    rec.onspeechend   = () => console.log('[DD VN] SR onspeechend');
    rec.onnomatch     = () => console.log('[DD VN] SR onnomatch');

    rec.onresult = e => {
      if (!this._active || this._recognition !== rec) return;
      // Any successful result resets the network-fail backoff.
      this._srNetworkFails = 0;

      // Pull every NEW finalised fragment into the running buffer, and
      // capture the latest interim guess separately. We don't commit each
      // final fragment to the chat log directly — that's what produced the
      // "one word per line" behaviour. Instead we wait for the user to
      // pause speaking (UTTERANCE_PAUSE_MS) and then flush the whole
      // accumulated phrase as a single chat line.
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = (r[0]?.transcript || '').trim();
        if (!txt) continue;
        if (r.isFinal) {
          // Append this finalised fragment to the buffer with a single
          // space separator — `.trim()` collapses repeated whitespace.
          this._utteranceBuffer = (this._utteranceBuffer + ' ' + txt).replace(/\s+/g, ' ').trim();
          console.log('[DD VN] SR fragment final →buffer', { fragment: txt, buffer: this._utteranceBuffer });
        } else {
          interim = txt; // latest interim wins
        }
      }

      // Build the live preview line: confirmed words so far + current
      // interim guess. This is the "growing sentence" the speaker expects
      // to see. Render as an interim so it doesn't pollute history.
      const live = ((this._utteranceBuffer + ' ' + interim).replace(/\s+/g, ' ').trim());
      if (live) DDVNManager.onSpeechResult(live, false);

      // (Re)start the pause timer — when the user stops contributing new
      // words for UTTERANCE_PAUSE_MS, flush the buffer as a final chat
      // line. Any new SR activity before the timer expires resets it.
      if (this._utteranceTimer) clearTimeout(this._utteranceTimer);
      if (this._utteranceBuffer) {
        this._utteranceTimer = setTimeout(() => this._flushUtterance(), this.UTTERANCE_PAUSE_MS);
      }
    };

    rec.onerror = e => {
      if (!this._active || this._recognition !== rec) return;
      console.warn('[DD VN] SR onerror:', e.error, e.message ?? '');
      if (e.error === 'not-allowed') {
        this._srGaveUp = true;
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.notifications.micDenied'));
      } else if (e.error === 'network') {
        this._srNetworkFails++;
        if (this._srNetworkFails === 1) {
          // Tell the user *once*. Spamming the notification on every retry
          // (~1 per second) just buries the rest of the console.
          ui.notifications?.warn('Нет связи с Google STT. Нажмите STT → «Скачать Whisper tiny» и выберите локальное распознавание.', { permanent: false });
        }
        if (this._srNetworkFails >= 3) {
          // Give up auto-restarting. Foundry & the chat input still work.
          this._srGaveUp = true;
          console.warn('[DD VN] giving up on SpeechRecognition after 3 network failures — chat input is the fallback');
        }
      } else if (e.error === 'no-speech') {
        // benign — VAD will retrigger us
      } else if (e.error === 'language-not-supported') {
        this._srGaveUp = true;
        ui.notifications?.warn(`Язык распознавания "${this.lang}" не поддерживается.`);
      }
    };
    rec.onend = () => {
      console.log('[DD VN] SR onend; active=', this._active, 'gaveUp=', this._srGaveUp);
      if (this._active && this._recognition === rec && !this._srGaveUp) {
        try { rec.start(); } catch(err) { console.warn('[DD VN] SR auto-restart failed', err); }
      }
    };
    try {
      rec.start();
    } catch(err) {
      console.error('[DD VN] SR.start() threw:', err);
      ui.notifications?.error('Не удалось запустить распознавание речи — см. F12 → Console.');
    }
    this._recognition = rec;
  }

  // Lets the user re-enable STT after fixing whatever blocked Google access
  // (VPN, firewall, etc.) without having to reload Foundry.
  static resetSpeechFailures() {
    this._srNetworkFails = 0;
    this._srGaveUp = false;
    this.restartSpeech();
  }

  static restartSpeech() {
    ++this._speechGeneration;
    const old = this._recognition; this._recognition = null;
    try { old?.abort(); } catch {}
    this._localSpeech?.stop(); this._localSpeech = null;
    this._flushUtterance(); this._srGaveUp = false; this._srNetworkFails = 0;
    if (this._active) this._startSpeech();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESETS
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNPresets {
  static CHARS_KEY = 'vnCharPresets';
  static BG_KEY = 'vnBgPresets';
  static SCENE_KEY    = 'vnScenePresets';
  static LAYERS_KEY   = 'vnLayerPresets';
  static IIMGS_KEY    = 'vnIimgPresets';
  static AUTOSAVE_KEY = 'vnAutoSave';    // single slot autosave
  static LASTSAVE_KEY = 'vnLastSaveType'; // 'auto' | 'quick' | null
  // Persistent master lists — objects live here forever until explicitly deleted
  static LAYERS_MASTER_KEY = 'vnLayersMaster';
  static IIMGS_MASTER_KEY  = 'vnIimgsMaster';

  static register() {
    if (this._registered) return;
    this._registered = true;
    const base = { scope: 'world', config: false, type: Object, default: {} };
    for (const k of [this.CHARS_KEY, this.BG_KEY, this.SCENE_KEY, this.LAYERS_KEY, this.IIMGS_KEY])
      game.settings.register(MODULE_ID, k, { ...base });
    game.settings.register(MODULE_ID, this.AUTOSAVE_KEY, { scope: 'world', config: false, type: Object, default: null });
    game.settings.register(MODULE_ID, this.LASTSAVE_KEY, { scope: 'world', config: false, type: String, default: '' });
    game.settings.register(MODULE_ID, this.LAYERS_MASTER_KEY, { scope: 'world', config: false, type: Array, default: [] });
    game.settings.register(MODULE_ID, this.IIMGS_MASTER_KEY,  { scope: 'world', config: false, type: Array, default: [] });
  }

  // ── Master list helpers ──────────────────────────────────────────────────
  /** Fields saved in a transform preset snapshot (not the full object definition) */
  static TRANSFORM_FIELDS = ['id', 'visible', 'x', 'y', 'zIndex', 'scale', 'baseScale', 'opacity', 'width', 'height'];

  static getMasterLayers() {
    try { return game.settings.get(MODULE_ID, this.LAYERS_MASTER_KEY) || []; } catch { return []; }
  }
  static async saveMasterLayers(layers) {
    if (!game.user?.isGM) return; try { await game.settings.set(MODULE_ID, this.LAYERS_MASTER_KEY, deepClone(layers)); } catch {}
  }
  static getMasterIimgs() {
    try { return game.settings.get(MODULE_ID, this.IIMGS_MASTER_KEY) || []; } catch { return []; }
  }
  static async saveMasterIimgs(iimgs) {
    if (!game.user?.isGM) return; try { await game.settings.set(MODULE_ID, this.IIMGS_MASTER_KEY, deepClone(iimgs)); } catch {}
  }

  /** Build a scene object ready to save.
   *  For AutoSave: layers/iimgs are stored FULLY so they survive a fresh session
   *  where the master list hasn't been loaded yet.
   *  For named Scene Presets: layers/iimgs are stored as transform-only snapshots
   *  (caller must pass transformOnly=true). */
  static makeSceneSnapshot(state, transformOnly = false) {
    const snap = deepClone(state);
    if (transformOnly) {
      snap.layers            = this.toTransformSnapshot(state.layers || []);
      snap.interactiveImages = this.toTransformSnapshot(state.interactiveImages || []);
    }
    // else: full deepClone already done — layers/iimgs kept intact
    return snap;
  }

  /** Extract only transform fields from an array of objects → used when saving a preset */
  static toTransformSnapshot(items) {
    return items.map(item => {
      const snap = {};
      for (const f of this.TRANSFORM_FIELDS) if (f in item) snap[f] = item[f];
      return snap;
    });
  }

  /** Apply a transform snapshot to the master list. Only updates matching objects by id. */
  static applyTransformSnapshot(master, snapshot) {
    const map = new Map(snapshot.map(s => [s.id, s]));
    return master.map(item => {
      const snap = map.get(item.id);
      if (!snap) return item;
      const updated = { ...item };
      for (const f of this.TRANSFORM_FIELDS) {
        if (f !== 'id' && f in snap) updated[f] = snap[f];
      }
      return updated;
    });
  }

  static getAutoSave()           { try { return game.settings.get(MODULE_ID, this.AUTOSAVE_KEY) || null; } catch { return null; } }
  static async saveAutoSave(v)   { if (!game.user?.isGM) return; await game.settings.set(MODULE_ID, this.AUTOSAVE_KEY, v); }
  static getLastSaveType()       { try { return game.settings.get(MODULE_ID, this.LASTSAVE_KEY) || ''; } catch { return ''; } }
  static async setLastSaveType(t){ if (!game.user?.isGM) return; await game.settings.set(MODULE_ID, this.LASTSAVE_KEY, t); }

  static _g(k) { return game.settings.get(MODULE_ID, k) || {}; }
  static _s(k, v) { if (!game.user?.isGM) return Promise.resolve(); return game.settings.set(MODULE_ID, k, v); }

  static listBg() { return Object.entries(this._g(this.BG_KEY)).map(([id, v]) => ({ id, ...v })); }
  static saveBg(id, data) { const a = this._g(this.BG_KEY); a[id] = data; return this._s(this.BG_KEY, a); }
  static deleteBg(id) { const a = this._g(this.BG_KEY); delete a[id]; return this._s(this.BG_KEY, a); }

  static listChars() { return Object.keys(this._g(this.CHARS_KEY)).sort(); }
  static saveChars(n,v) { const a = this._g(this.CHARS_KEY); a[n] = v; return this._s(this.CHARS_KEY, a); }
  static getChars(n) { return this._g(this.CHARS_KEY)[n] ?? null; }
  static deleteChars(n) { const a = this._g(this.CHARS_KEY); delete a[n]; return this._s(this.CHARS_KEY, a); }

  static listScenes() { return Object.keys(this._g(this.SCENE_KEY)).sort(); }
  static saveScene(n,v) { const a = this._g(this.SCENE_KEY); a[n] = v; return this._s(this.SCENE_KEY, a); }
  static getScene(n) { return this._g(this.SCENE_KEY)[n] ?? null; }
  static deleteScene(n) { const a = this._g(this.SCENE_KEY); delete a[n]; return this._s(this.SCENE_KEY, a); }

  static listLayers() { return Object.keys(this._g(this.LAYERS_KEY)).sort(); }
  static saveLayers(n, v) { const a = this._g(this.LAYERS_KEY); a[n] = v; return this._s(this.LAYERS_KEY, a); }
  static getLayers(n) { return this._g(this.LAYERS_KEY)[n] ?? null; }
  static deleteLayers(n) { const a = this._g(this.LAYERS_KEY); delete a[n]; return this._s(this.LAYERS_KEY, a); }

  static listIimgs() { return Object.keys(this._g(this.IIMGS_KEY)).sort(); }
  static saveIimgs(n, v) { const a = this._g(this.IIMGS_KEY); a[n] = v; return this._s(this.IIMGS_KEY, a); }
  static getIimgs(n) { return this._g(this.IIMGS_KEY)[n] ?? null; }
  static deleteIimgs(n) { const a = this._g(this.IIMGS_KEY); delete a[n]; return this._s(this.IIMGS_KEY, a); }

  static getAllBg() {
    const builtin = _resolveBgNames(VN_BUILTIN_BACKGROUNDS);
    const custom = this.listBg().map(b => ({ ...b, _builtin: false }));
    return [...builtin, ...custom];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANAGER
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNManager {
  static sceneItem(key) {
    if (typeof key !== 'string') return null;
    const colon = key.indexOf(':'), type = key.slice(0, colon), id = key.slice(colon + 1);
    const list = type === 'char' ? _state.chars : type === 'layer' ? _state.layers : type === 'interactive' ? _state.interactiveImages : type === 'object' ? _state.scene3d.objects : [];
    const item = list.find(i => i.id === id); return item ? { item, list, type } : null;
  }
  static editSceneItem(key, patch, model = false, live = false) {
    if (!game.user?.isGM) return;
    const entry = this.sceneItem(key); if (!entry) return;
    if (model) { this.edit3D(patch, key, live, true); SceneEditor.sync(); return; }
    const { item, type } = entry;
    const next = { ...patch };
    for (const field of ['width', 'height', 'fontSize']) if (field in next) next[field] = Math.max(1, Math.min(10000, Number(next[field]) || 1));
    if ('scale' in next) { next.scale = Math.max(0.01, Math.min(100, Number(next.scale) || 1)); next.baseScale = next.scale; }
    if ('opacity' in next) next.opacity = Math.max(0, Math.min(1, Number(next.opacity) || 0));
    if (type === 'char' && 'x' in next) { next._pinned = true; next._pinnedWidth = item._pinnedWidth || 420; }
    Object.assign(item, next);
    if (type === 'char' && item.model3d && 'locked' in next) item.model3d.locked = !!next.locked;
    this.syncEditorCopies();
    if (live && Object.keys(next).every(k => ['x', 'y', 'scale', 'baseScale', 'zIndex', '_pinned', '_pinnedWidth'].includes(k))) {
      this._motion.push(type, item.id, next); DDVNOverlay.moveRemoteElement(type, item);
    } else this.broadcast();
  }
  static syncEditorCopies() {
    const panel = DDVNPanel._instance; if (!panel) return;
    panel._chars = deepClone(_state.chars); panel._layers = deepClone(_state.layers); panel._interactiveImages = deepClone(_state.interactiveImages);
  }
  static duplicateSceneItem(key) {
    if (!game.user?.isGM) return null;
    const entry = this.sceneItem(key); if (!entry) return null;
    const copy = deepClone(entry.item); copy.id = uid(); copy.name = `${copy.name || 'Элемент'} — копия`; copy.locked = false;
    if (entry.type === 'object') copy.x = (copy.x || 0) + 1;
    else { copy.x = (copy.x || 0) + 40; if (copy.model3d) { copy.model3d.x = (copy.model3d.x || 0) + 1; copy.model3d.locked = false; } }
    delete copy.sourceTokenUuid; delete copy.tokenUuid; delete copy.fromMap;
    entry.list.push(copy); this.syncEditorCopies(); this.broadcast(); return `${entry.type}:${copy.id}`;
  }
  static removeSceneItem(key) {
    if (!game.user?.isGM) return;
    const entry = this.sceneItem(key); if (!entry) return;
    entry.list.splice(entry.list.indexOf(entry.item), 1); this.syncEditorCopies(); this.broadcast();
  }
  static _motion = new MotionQueue(changes => {
    if (!_state.open || (game.user?.isGM && !DDVNManager._shownToPlayers)) return;
    game.socket.emit(SOCKET, { type: 'vn:motion', userId: game.userId, changes });
  });
  static receiveMotion(data) {
    if (!_state.open || data.userId === game.userId || this._gmOnlyMode) return;
    const user = game.users?.get(data.userId); if (!user) return;
    for (const change of (data.changes || []).slice(0, 200)) {
      const { kind, id, props } = change;
      if (!props || typeof props !== 'object') continue;
      if (kind === '3d' && user.isGM) {
        if (id === null) _state.scene3d = scene3D({ ..._state.scene3d, ...props });
        else if (id.startsWith('char:')) {
          const char = _state.chars.find(c => `char:${c.id}` === id);
          if (char) char.model3d = model3D({ ...char.model3d, ...props });
        } else {
          const obj = _state.scene3d.objects.find(o => `object:${o.id}` === id);
          if (obj) Object.assign(obj, model3D({ ...obj, ...props }));
        }
      } else if (['char', 'layer', 'interactive'].includes(kind)) {
        const list = kind === 'char' ? _state.chars : kind === 'layer' ? _state.layers : _state.interactiveImages;
        const item = list.find(o => o.id === id);
        if (!item || (!user.isGM && (!(_state.playerControl && kind === 'char' && item.playerId === user.id) || item.locked))) continue;
        const allowed = ['x', 'y', 'zIndex', 'scale', '_pinned', '_pinnedWidth'];
        for (const field of allowed) if (field in props && (field === '_pinned' ? typeof props[field] === 'boolean' : Number.isFinite(props[field]))) item[field] = props[field];
        DDVNOverlay.moveRemoteElement(kind, item);
      }
    }
    VN3D.renderer?.update(_state);
    SceneEditor.syncFields();
  }
  static edit3D(patch, key, live = false, fromPanel = false) {
    if (!game.user?.isGM || (!_state.mouseControl && !fromPanel)) return;
    let normalized;
    if (key === null) {
      normalized = scene3D({ ..._state.scene3d, ...patch });
      _state.scene3d = normalized;
    } else if (key.startsWith('char:')) {
      const char = _state.chars.find(c => `char:${c.id}` === key);
      if (!char) return;
      // The toolbar lock controls both existing character lock and model lock.
      if ('locked' in patch) char.locked = patch.locked;
      char.model3d = model3D({ ...char.model3d, ...patch });
      normalized = char.model3d;
      const local = DDVNPanel._instance?._chars.find(c => c.id === char.id);
      if (local) { local.model3d = deepClone(normalized); local.locked = char.locked; }
    } else {
      const obj = _state.scene3d.objects.find(o => `object:${o.id}` === key);
      if (!obj) return;
      Object.assign(obj, model3D({ ...obj, ...patch })); normalized = obj;
    }
    const fields = Object.fromEntries(Object.keys(patch).map(k => [k, normalized[k]]));
    DDVNPanel._instance?.element?.querySelector('#vn-3d-editor')?.dispatchEvent(new CustomEvent('vn3d-transform', { detail: { key, patch: fields } }));
    if (live) {
      this._motion.push('3d', key, fields);
      if (fromPanel) VN3D.renderer?.update(_state);
    }
    else this.broadcast();
    SceneEditor.syncFields();
  }
  static _subTimer = null;
  static _gmOnlyMode = false;
  static _shownToPlayers = false;
  static _autoSaveTimer = null;

  static getState() { return _state; }


  /** Синхронизирует поля x/y/z/scale в открытой панели после завершения дрэга.
   *  Использует data-char-idx / data-layer-idx — именно эти атрибуты в шаблоне. */
  static _syncPanelFields(type, id) {
    const p = DDVNPanel._instance;
    if (!p?.element) return;

    // Берём актуальное значение из _state
    let list;
    if (type === 'char')        list = _state.chars;
    else if (type === 'layer')  list = _state.layers;
    else                        list = _state.interactiveImages;

    const si = list?.find(i => i.id === id);
    if (!si) return;

    // Также синхронизируем локальную копию в экземпляре панели
    let localArr;
    if (type === 'char')        localArr = p._chars;
    else if (type === 'layer')  localArr = p._layers;
    else                        localArr = p._interactiveImages;
    const li = localArr?.find(i => i.id === id);
    if (li) {
      li.x = si.x; li.y = si.y; li.zIndex = si.zIndex;
      li.scale = si.scale; li.baseScale = si.baseScale;
      li._pinned = si._pinned; li._pinnedWidth = si._pinnedWidth;
    }

    // Находим строку в DOM — перебираем все char-row и сверяем data-char-idx
    if (type === 'char') {
      const idx = p._chars?.findIndex(c => c.id === id);
      if (idx < 0) return;
      // New layout: inspector body per char
      const insp = p.element.querySelector(`.vn-char-inspector-body[data-char-idx="${idx}"]`);
      if (!insp) return;
      const set = (sel, v) => {
        const el = insp.querySelector(sel);
        if (el && el !== document.activeElement) el.value = v;
      };
      set('.vn-char-x',     si.x           ?? 0);
      set('.vn-char-y',     si.y           ?? 0);
      set('.vn-char-z',     si.zIndex      ?? 0);
      set('.vn-char-scale', si.baseScale   ?? si.scale ?? 1);
    } else {
      // Layers and interactive images use slider+label rows — find by data-layer-idx / data-iimg-idx
      const isLayer = type === 'layer';
      const arr     = isLayer ? p._layers : p._interactiveImages;
      const rowSel  = isLayer ? '.vn-layer-row' : '.vn-iimg-row';
      const xSel    = isLayer ? '.vn-layer-x'   : '.vn-iimg-x';
      const ySel    = isLayer ? '.vn-layer-y'   : '.vn-iimg-y';
      const zSel    = isLayer ? '.vn-layer-z'   : '.vn-iimg-z';
      const sSel    = isLayer ? '.vn-layer-scale': '.vn-iimg-scale';
      const idxAttr = isLayer ? 'data-layer-idx': 'data-iimg-idx';

      const rowIdx = arr?.findIndex(i => i.id === id) ?? -1;
      if (rowIdx < 0) return;
      const row = p.element.querySelector(`${rowSel}[${idxAttr}="${rowIdx}"]`);
      if (!row) return;

      const setSlider = (sel, v) => {
        const el = row.querySelector(sel);
        if (!el || el === document.activeElement) return;
        el.value = v;
        const lbl = el.nextElementSibling;
        if (lbl?.classList.contains('vn-slider-val')) lbl.textContent = v;
      };
      setSlider(xSel, si.x      ?? 0);
      setSlider(ySel, si.y      ?? 0);
      setSlider(zSel, si.zIndex ?? 0);
      setSlider(sSel, si.baseScale ?? si.scale ?? 1);
    }
  }

  static broadcast(partial = null) {
    if (partial) Object.assign(_state, partial);
    this._motion.flush();
    if (_dragState.active) return;  // во время drag: только CSS, без emit и apply

    // Debounced autosave — fires 1500ms after the last state change
    if (game.user?.isGM && _state.open) {
      clearTimeout(this._autoSaveTimer);
      this._autoSaveTimer = setTimeout(() => { this._autoSave(); }, 1500);
    }

    // If not yet shown to players, only apply locally (GM preview)
    if (!this._shownToPlayers && game.user?.isGM) {
      DDVNOverlay.apply(_state);
      return;
    }
    game.socket.emit(SOCKET, { type: 'vn:state', state: deepClone(_state) });
    DDVNOverlay.apply(_state);
  }

  static applyRemote(state) {
    state = { ...state, scene3d: scene3D(state.scene3d) };
    state.chars = (state.chars || []).map(c => ({ ...c, model3d: model3D(c.model3d) }));
    Object.assign(_state, state);
    DDVNOverlay.apply(_state);
  }

  static open() {
    // Auto-load last session (AutoSave > QuickSave).
    // AutoSave already contains full char state (positions, scale, etc.)
    // so we MUST NOT overwrite chars with InfiniteRoaster preset afterwards —
    // that preset only stores the roster without drag positions.
    this._autoLoadLastSave();
    _state.open = true;
    this._gmOnlyMode = false;
    this._shownToPlayers = false;
    DDVNOverlay.build();
    // Only show locally to GM, don't broadcast to players yet
    DDVNOverlay.apply(_state);
    DDVNPanel._instance?.render();
  }

  static launchWithMapCharacters() {
    if (!game.user?.isGM) return;
    const scene = globalThis.canvas?.scene;
    const users = game.users?.contents || [...game.users];
    const tokens = [...(scene?.tokens || [])].filter(t => !t.hidden && t.actor &&
      (t.actor.hasPlayerOwner || users.some(u => !u.isGM && u.character?.id === (t.actorId || t.actor.id))));
    if (!tokens.length) { ui.notifications?.warn('На текущей карте нет видимых токенов персонажей игроков.'); return; }
    if (!_state.open) this.open();
    _state.chars = charactersFromMap(_state, tokens, users, newChar);
    if (DDVNPanel._instance) DDVNPanel._instance._chars = deepClone(_state.chars);
    this.broadcast(); DDVNPanel._instance?.render();
  }

  static showToPlayers() {
    if (!game.user?.isGM) return;
    this._shownToPlayers = true;
    this.broadcast();
    ui.notifications?.info(game.i18n.localize('DRAMADIRECTOR.notifications.vnShownToPlayers') || 'VN сцена показана игрокам');
  }

  static openLocal() {
    // Auto-load last session (AutoSave > QuickSave).
    // AutoSave already contains full char state (positions, scale, etc.)
    this._autoLoadLastSave();
    _state.open = true;
    this._gmOnlyMode = true;
    this._shownToPlayers = false;
    DDVNOverlay.build();
    DDVNOverlay.apply(_state);
    DDVNPanel._instance?.render();
    ui.notifications?.info(game.i18n.localize('DRAMADIRECTOR.notifications.vnGmOnly'));
  }

  static async stop(bcast = false) {
    // Cancel any pending debounced autosave — we save right now and await it
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = null;
    // Autosave current scene before closing — await so it completes before we proceed
    await this._autoSave();
    _state.open = false;
    DDVNMic.stop();
    if (bcast) {
      // Всегда отправляем закрытие всем игрокам, независимо от _shownToPlayers
      game.socket.emit(SOCKET, { type: 'vn:state', state: deepClone(_state) });
    }
    this._gmOnlyMode = false;
    this._shownToPlayers = false;
    DDVNOverlay.apply(_state);
    DDVNPanel._instance?.render();
  }

  static async stopLocal() {
    // Cancel any pending debounced autosave — we save right now and await it
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = null;
    // Autosave current scene before closing — await so it completes before we proceed
    await this._autoSave();
    _state.open = false;
    this._gmOnlyMode = false;
    this._shownToPlayers = false;
    DDVNMic.stop();
    DDVNOverlay.apply(_state);
    DDVNPanel._instance?.render();
  }

  /** Save current state as AutoSave slot. Returns a Promise so callers can await it. */
  static async _autoSave() {
    if (!game.user?.isGM) return;
    const snapshot = DDVNPresets.makeSceneSnapshot(_state);
    snapshot._savedAt = Date.now();
    await DDVNPresets.saveAutoSave(snapshot);
    await DDVNPresets.setLastSaveType('auto');
    // Flash the autosave badge
    const badge = document.getElementById('vn-ctrl-autosave-badge');
    if (badge) {
      badge.style.display = 'inline-flex';
      badge.classList.add('vn-autosave-flash');
      setTimeout(() => badge.classList.remove('vn-autosave-flash'), 1400);
    }
  }

  /** Restore the most recently saved state (AutoSave > QuickSave) */
  static _autoLoadLastSave() {
    if (!game.user?.isGM) return;
    const lastType = DDVNPresets.getLastSaveType();
    let scene = null;
    let sourceLabel = '';

    if (lastType === 'auto') {
      scene = DDVNPresets.getAutoSave();
      sourceLabel = 'AutoSave';
      if (!scene) { scene = DDVNPresets.getScene('QuickSave'); sourceLabel = 'QuickSave'; }
    } else if (lastType === 'quick') {
      scene = DDVNPresets.getScene('QuickSave');
      sourceLabel = 'QuickSave';
      if (!scene) { scene = DDVNPresets.getAutoSave(); sourceLabel = 'AutoSave'; }
    } else {
      scene = DDVNPresets.getAutoSave();
      sourceLabel = 'AutoSave';
      if (!scene) { scene = DDVNPresets.getScene('QuickSave'); sourceLabel = 'QuickSave'; }
    }

    if (scene) {
      const { _savedAt, _fullSnapshot, ...sceneData } = scene;
      DDVNManager.applySceneState(sceneData);
      // Notify GM
      setTimeout(() => {
        ui.notifications?.info(`Drama Director: загружено «${sourceLabel}»`);
        const badge = document.getElementById('vn-ctrl-autosave-badge');
        if (badge) badge.style.display = 'inline-flex';
      }, 400);
    }
  }

  static isGmOnlyMode() { return this._gmOnlyMode; }
  static isShownToPlayers() { return this._shownToPlayers; }

  // Player closes VN locally (hides overlay on their screen)
  static playerCloseLocal() {
    _state.open = false;
    DDVNMic.stop();
    DDVNOverlay.apply(_state);
  }

  static setBackground(path) {
    _state.background = path;
    this.broadcast();
  }

  static setChars(chars) {
    _state.chars = deepClone(chars);
    // broadcast() already starts the debounced autosave timer (1500ms).
    // AutoSave stores the full state including char positions, so no separate
    // InfiniteRoaster preset save is needed here.
    this.broadcast();
    DDVNOverlay.ensureOpen();
  }

  // ── Quick-save current scene state (called from overlay save button) ──────
  static async quickSaveScene() {
    const btn = document.getElementById('vn-ctrl-quicksave');
    const icon = btn?.querySelector('i');

    // Use a fixed slot named "QuickSave"
    const name = 'QuickSave';
    await DDVNPresets.saveScene(name, DDVNPresets.makeSceneSnapshot(_state, true));
    DDVNPresets.setLastSaveType('quick');

    // Visual feedback
    if (icon) {
      icon.className = 'fas fa-check';
      setTimeout(() => { icon.className = 'fas fa-save'; }, 1200);
    }
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.sceneSaved', { name }));

    // Refresh panel preset list if open
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static activateExclusive(id) {
    _state.chars.forEach(c => { c.active = c.id === id; });
    this.broadcast();
  }

  static activateChar(id, val = true) {
    const c = _state.chars.find(c => c.id === id);
    if (c) { c.active = val; this.broadcast(); }
  }

  static deactivateAll() {
    _state.chars.forEach(c => { c.active = false; });
    this.broadcast();
  }

  // ── Layers ───────────────────────────────────────────────────────────────
  static setLayers(layers) {
    _state.layers = deepClone(layers);
    this.broadcast();
    // Persist master list asynchronously — fire and forget
    DDVNPresets.saveMasterLayers(layers);
  }
  static addLayer(layer) { _state.layers.push(deepClone(layer)); this.broadcast(); }
  static updateLayer(id, props) {
    const l = _state.layers.find(l => l.id === id);
    if (l) { Object.assign(l, props); this.broadcast(); }
  }
  static removeLayer(id) { _state.layers = _state.layers.filter(l => l.id !== id); this.broadcast(); }

  // ── Interactive Images ───────────────────────────────────────────────────
  static setInteractiveImages(images) {
    _state.interactiveImages = deepClone(images);
    this.broadcast();
    // Persist master list asynchronously
    DDVNPresets.saveMasterIimgs(images);
  }
  static addInteractiveImage(img) { _state.interactiveImages.push(deepClone(img)); this.broadcast(); }
  static updateInteractiveImage(id, props) {
    const img = _state.interactiveImages.find(i => i.id === id);
    if (img) { Object.assign(img, props); this.broadcast(); }
  }
  static removeInteractiveImage(id) { _state.interactiveImages = _state.interactiveImages.filter(i => i.id !== id); this.broadcast(); }

  // ── Generic Element Position Update ──────────────────────────────────────
  static updateElementPosition(type, id, props) {
    let list;
    if (type === 'char') list = _state.chars;
    else if (type === 'layer') list = _state.layers;
    else if (type === 'interactive') list = _state.interactiveImages;
    else return;
    
    const item = list.find(item => item.id === id);
    if (item) {
      Object.assign(item, props);
      if (type === 'char') {
        item._pinned = true;
        if (!item._pinnedWidth && _dragState.active && _dragState.id === id) {
          item._pinnedWidth = _dragState.pinnedWidth || 420;
        }
      }
      // During drag: move only this element's DOM node directly, skip full re-render
      if (_dragState.active && _dragState.id === id) {
        SceneEditor.syncFields();
        this._motion.push(type, id, { ...props, ...(type === 'char' ? { _pinned: true, _pinnedWidth: item._pinnedWidth } : {}) });
        const el = _dragState.element;
        if (el && type === 'char') {
          if (props.x !== undefined) el.style.left = props.x + 'px';
          const charWrap = el.querySelector('.vn-char-wrapper');
          if (charWrap && props.y !== undefined) charWrap.style.transform = `translateY(${props.y}px)`;
          const wrapper = el.querySelector('.vn-char-portrait');
          if (wrapper && props.scale !== undefined) {
            const mx = _dragState.mirrorX ?? 1;
            wrapper.style.transform = `scaleX(${mx}) scale(${props.scale})`;
          }
        } else if (el && (type === 'layer' || type === 'interactive')) {
          const hw = (item.width  || (_dragState.elemW ?? 200)) / 2;
          const hh = (item.height || (_dragState.elemH ?? 200)) / 2;
          if (props.x !== undefined) el.style.left = (props.x + hw) + 'px';
          if (props.y !== undefined) el.style.top  = (props.y + hh) + 'px';
          if (props.scale !== undefined) el.style.transform = `translate(-50%,-50%) scale(${props.scale})`;
        }
        if (el && props.zIndex !== undefined) el.style.zIndex = String(props.zIndex + 1000);
      }
      if (!_dragState.active) this.broadcast();
    }
  }

  // ── Позиция элемента без broadcast (только state, вызывается из dragEnd) ──
  static updateElementPositionSilent(type, id, props) {
    let list;
    if (type === 'char') list = _state.chars;
    else if (type === 'layer') list = _state.layers;
    else if (type === 'interactive') list = _state.interactiveImages;
    else return;
    const item = list.find(i => i.id === id);
    if (item) {
      Object.assign(item, props);
      if (type === 'char') {
        item._pinned = true;
        if (!item._pinnedWidth && _dragState.pinnedWidth) item._pinnedWidth = _dragState.pinnedWidth;
      }
    }
  }

  // ── Lock/Unlock ───────────────────────────────────────────────────────────
  // При включении depth mode: сохраняем текущий scale как baseScale,
  // затем пересчитываем scale и zIndex из текущей Y-позиции для всех элементов.
  static _snapshotAndRecalcDepth() {
    const recalc = (items, type) => {
      items.forEach(item => {
        const pf = DDVNOverlay._perspectiveFactor(DDVNOverlay._depthY(type, item));
        const currentScale = item.scale ?? item.baseScale ?? 1;
        if (pf > 0.01) {
          // Back-calculate baseScale so that baseScale × pf = currentScale.
          // This means NO visual jump when depth mode is enabled —
          // the element looks exactly the same, but now has the correct baseScale
          // so that subsequent dragging scales it correctly.
          item.baseScale = parseFloat((currentScale / pf).toFixed(3));
        } else {
          // At or above horizon: just snapshot current scale, prevent div-by-zero
          item.baseScale = currentScale;
        }
        // scale stays unchanged → no visual jump
        // only zIndex is updated from current Y
        item.zIndex = DDVNOverlay._depthZ(type, item);
      });
    };
    recalc(_state.chars,             'char');
    recalc(_state.layers,            'layer');
    recalc(_state.interactiveImages, 'interactive');
    console.log('DD VN | Depth mode ON — baseScales back-calculated, no visual jump');
  }

  // ── Единый метод применения пресета сцены ────────────────────────────────
  // Вызывается из GM-бара и из панели. Применяет ВСЕ поля состояния.
  static applySceneState(scene) {
    if (!scene) return;
    this._motion.clear();
    // A legacy 2D preset explicitly disables the previous scene's 3D content.
    _state.scene3d = scene3D(scene.scene3d);

    // Фон и оформление
    if (scene.background  !== undefined) _state.background  = scene.background;
    if (scene.bgFit       !== undefined) _state.bgFit       = scene.bgFit;
    if (scene.bgColor     !== undefined) _state.bgColor     = scene.bgColor;
    if (scene.dimBg       !== undefined) _state.dimBg       = scene.dimBg;

    // Элементы сцены
    if (scene.chars) _state.chars = deepClone(scene.chars).map(c => ({ ...c, model3d: model3D(c.model3d) }));
    // Layers/iimgs: AutoSave stores full objects; named presets store transform-only snapshots.
    // Detect by checking if first item has 'src' or 'type' (full) vs only transform fields (snapshot).
    if (scene.layers) {
      const isFullLayers = scene.layers.length === 0 || ('src' in scene.layers[0] || 'type' in scene.layers[0]);
      if (isFullLayers) {
        _state.layers = deepClone(scene.layers);
      } else {
        _state.layers = DDVNPresets.applyTransformSnapshot(_state.layers, scene.layers);
      }
    }
    if (scene.interactiveImages) {
      const isFullIimgs = scene.interactiveImages.length === 0 || ('src' in scene.interactiveImages[0]);
      if (isFullIimgs) {
        _state.interactiveImages = deepClone(scene.interactiveImages);
      } else {
        _state.interactiveImages = DDVNPresets.applyTransformSnapshot(_state.interactiveImages, scene.interactiveImages);
      }
    }

    // Диалог
    if (scene.dialogue) {
      _state.dialogue = { ...scene.dialogue, _subtitleActive: false };
    }

    // Управление мышью и глубиной
    if (scene.mouseControl      !== undefined) _state.mouseControl      = scene.mouseControl;
    if (scene.depthMode         !== undefined) _state.depthMode         = scene.depthMode;
    if (scene.playerControl     !== undefined) _state.playerControl     = scene.playerControl;
    if (scene.depthScaleMultiplier !== undefined) _state.depthScaleMultiplier = scene.depthScaleMultiplier;
    if (scene.depthYMultiplier  !== undefined) _state.depthYMultiplier  = scene.depthYMultiplier;

    // Горизонт
    if (scene.horizonLine !== undefined) _state.horizonLine = scene.horizonLine;
    if (scene.horizonY    !== undefined) _state.horizonY    = scene.horizonY;
    if (scene.hideHorizonLine !== undefined) _state.hideHorizonLine = scene.hideHorizonLine;
    // Infinite roster is the only supported mode now; ignore legacy `false`
    // values from older scenes and force it back on.
    _state.infiniteRoster = true;
    if (_state.horizonLine) {
      DDVNManager.initHorizonLine();
    } else {
      DDVNManager.clearHorizonLine();
    }

    // Синхронизируем локальные копии в панели если она открыта
    if (DDVNPanel._instance) {
      DDVNPanel._instance._chars             = deepClone(_state.chars);
      DDVNPanel._instance._layers            = deepClone(_state.layers);
      DDVNPanel._instance._interactiveImages = deepClone(_state.interactiveImages);
      DDVNPanel._instance.render();
    }

    this.broadcast();
    DDVNOverlay.ensureOpen();
  }

  static toggleLock(type, id) {
    let item = null;
    if (type === 'char') item = _state.chars.find(c => c.id === id);
    else if (type === 'layer') item = _state.layers.find(l => l.id === id);
    else if (type === 'interactive') item = _state.interactiveImages.find(i => i.id === id);
    
    if (item) {
      item.locked = !item.locked;
      if (type === 'char' && item.model3d) item.model3d.locked = item.locked;
      this.broadcast();
      ui.notifications?.info(item.locked 
        ? game.i18n.format('DRAMADIRECTOR.vn.gml.elementLocked', {name: item.name || id})
        : game.i18n.format('DRAMADIRECTOR.vn.gml.elementUnlocked', {name: item.name || id})
      );
    }
  }

  static setLock(type, id, locked) {
    let item = null;
    if (type === 'char') item = _state.chars.find(c => c.id === id);
    else if (type === 'layer') item = _state.layers.find(l => l.id === id);
    else if (type === 'interactive') item = _state.interactiveImages.find(i => i.id === id);
    
    if (item) {
      item.locked = locked;
      if (type === 'char' && item.model3d) item.model3d.locked = item.locked;
      this.broadcast();
    }
  }

  // ── Horizon Line ───────────────────────────────────────────────────────────
  static initHorizonLine() {
    // Горизонт теперь задаётся вручную в % от высоты стейджа (1080px)
    const pct = _state.horizonY ?? 30;
    _horizonY = Math.round((pct / 100) * 1080);
    console.log('DD VN | Horizon line set at Y:', _horizonY, `(${pct}% of stage)`);
    this._updateHorizonIndicator();
  }

  static _updateHorizonIndicator() {
    const stage = document.getElementById('vn-stage');
    if (!stage) return;

    let indicator = document.getElementById('vn-horizon-indicator');
    // Show indicator only when horizonLine is active AND hideHorizonLine is false
    if (_state.horizonLine && _horizonY !== null && !_state.hideHorizonLine) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'vn-horizon-indicator';
        indicator.style.cssText = [
          'position:absolute', 'left:0', 'right:0',
          'height:2px',
          'background:repeating-linear-gradient(90deg,rgba(255,220,60,.7) 0,rgba(255,220,60,.7) 12px,transparent 12px,transparent 20px)',
          'pointer-events:none',
          'z-index:9999',
          'transition:top .15s ease',
        ].join(';');
        // Метка
        const label = document.createElement('div');
        label.id = 'vn-horizon-label';
        label.style.cssText = 'position:absolute;right:10px;top:-18px;font-size:11px;color:rgba(255,220,60,.9);font-family:monospace;pointer-events:none;text-shadow:0 1px 3px #000;';
        label.textContent = `⬇ Горизонт`;
        indicator.appendChild(label);
        stage.appendChild(indicator);
      }
      indicator.style.top = _horizonY + 'px';
      // Обновляем процент в метке
      const label = indicator.querySelector('#vn-horizon-label');
      if (label) label.textContent = `⬇ Горизонт ${_state.horizonY ?? 30}%`;
    } else {
      indicator?.remove();
    }
  }

  static clearHorizonLine() {
    _horizonY = null;
    this._updateHorizonIndicator();
  }

  static showDialogue(speakerName, text, speakerColor = '#ffe066', autoClose = 0) {
    _state.dialogue = { visible: true, speakerName, text, speakerColor, _subtitleActive: _state.dialogue._subtitleActive };
    this.broadcast();
    if (autoClose > 0) setTimeout(() => this.hideDialogue(), autoClose * 1000);
  }

  static hideDialogue() {
    _state.dialogue.visible = false;
    this.broadcast();
  }

  static onLocalSpeaking(isSpeaking) {
    if (!_state.open) return;

    let myChar;
    if (game.user?.isGM) {
      const gmCharId = DDVNGMBar._gmCharId;
      if (!gmCharId) return;
      myChar = _state.chars.find(c => c.id === gmCharId);
    } else {
      myChar = _state.chars.find(c => c.playerId === game.userId);
    }

    if (!myChar) return;
    if (myChar.active !== isSpeaking) {
      myChar.active = isSpeaking;
      this.broadcast();
    }
  }

  static onSpeechResult(text, isFinal = true) {
    if (!_state.open) {
      console.log('[DD VN] onSpeechResult ignored — VN overlay is not open', { text });
      return;
    }

    let myChar = null;
    let charName = '';
    let charColor = '#ffe066';
    let charId = null;
    let isGM = game.user.isGM;

    if (isGM) {
      const gmCharId = DDVNGMBar._gmCharId;
      if (gmCharId) {
        myChar = _state.chars.find(c => c.id === gmCharId);
        charId = gmCharId;
      }
    } else {
      myChar = _state.chars.find(c => c.playerId === game.userId);
      charId = myChar?.id || null;
    }

    if (myChar) {
      charName = myChar.name || '';
      charColor = myChar.nameColor || '#ffe066';
    } else {
      charName = game.user?.name || '';
    }

    console.log('[DD VN] onSpeechResult →', { charName, charId, isFinal, text });
    DDVNOverlay.showSubtitle(charName, text, charColor, charId, isFinal);
    game.socket.emit(SOCKET, { type: 'vn:subtitle', name: charName, text, color: charColor, charId, isFinal, isGM });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PANEL
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  constructor(opts = {}) {
    super(opts);
    DDVNPanel._instance = this;
    this._chars = deepClone(_state.chars);
    this._layers = deepClone(_state.layers);
    this._interactiveImages = deepClone(_state.interactiveImages);
    this._activeTab = 'scene';
    this._editBgId = null;
    this._selectedCharId = null;
  }

  static DEFAULT_OPTIONS = {
    id: 'dd-vn-panel', tag: 'div',
    classes: ['drama-director', 'dd-vn-panel'],
    window: { title: 'Drama Director — Visual Novel', icon: 'fas fa-book-open', resizable: true },
    position: { width: 1100, height: 780 },
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/vn-panel.hbs` } };

  async _prepareContext() {
    await getLanguagePromise();
    
    // Синхронизируем локальные копии с глобальным состоянием
    // ВАЖНО: existing (локальная копия) имеет приоритет над state для полей,
    // которые пользователь редактирует в панели (playerId, name, emotions и т.д.)
    // State побеждает только для позиционных полей (x, y, scale, zIndex) —
    // их меняет drag и они должны синхронизироваться из state.
    // State wins for position AND for visibility/active (changed via GMBar, not panel form)
    const POSITION_FIELDS = ['x','y','scale','baseScale','zIndex','slot','_pinned','_pinnedWidth','visible','active','playerId'];
    const s = DDVNManager.getState();
    
    this._chars = s.chars.map(c => {
      const existing = this._chars.find(ec => ec.id === c.id);
      if (!existing) return deepClone(c);
      // Merge: start from existing (panel edits), overlay only position fields from state
      const merged = { ...existing };
      for (const f of POSITION_FIELDS) if (f in c) merged[f] = c[f];
      return merged;
    });
    this._layers = s.layers.map(l => {
      const existing = this._layers.find(el => el.id === l.id);
      return existing ? { ...existing, ...l } : deepClone(l);
    });
    this._interactiveImages = s.interactiveImages.map(img => {
      const existing = this._interactiveImages.find(ei => ei.id === img.id);
      return existing ? { ...existing, ...img } : deepClone(img);
    });
    
    const allBg = DDVNPresets.getAllBg();

    return {
      open: s.open,
      background: s.background,
      bgFit: s.bgFit,
      bgColor: s.bgColor,
      dimBg: s.dimBg,
      chars: this._chars.map((c, i) => ({ ...c, _idx: i })),
      actors: (game.actors?.contents || []).map(a => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
      mapTokens: [...(globalThis.canvas?.scene?.tokens || [])].map(t => ({ id: t.uuid, name: `${t.name} (${t.id})` })),
      spawnpoints: (s.scene3d.objects || []).filter(o => o.kind === 'spawnpoint').map(o => ({ id: o.id, name: o.name || o.id })),
      leftChars: this._chars.filter(c => c.side === 'left').length,
      centerChars: this._chars.filter(c => c.side === 'center').length,
      rightChars: this._chars.filter(c => c.side === 'right').length,
      players: game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: u.name })),
      micOn: DDVNMic._active,
      micThreshold: DDVNMic.threshold,
      micLang: DDVNMic.lang,
      dialogue: s.dialogue,
      charPresets: DDVNPresets.listChars(),
      scenePresets: DDVNPresets.listScenes(),
      allBg,
      gmCharId: this._gmCharId || '',
      layers: this._layers.map((l, i) => ({ ...l, _idx: i })),
      interactiveImages: this._interactiveImages.map((img, i) => ({ ...img, _idx: i })),
      macros: (game.macros?.contents || []).map(m => ({ id: m.id, name: m.name })).sort((a,b) => a.name.localeCompare(b.name)),
      layerPresets: DDVNPresets.listLayers(),
      iimgPresets: DDVNPresets.listIimgs(),
      depthMode: s.depthMode,
      infiniteRoster: s.infiniteRoster,
    };
  }

  _onRender(ctx, opts) {
    super._onRender?.(ctx, opts);
    const el = this.element;
    mountSTTSettings(el.querySelector('#vn-stt-settings'), () => DDVNMic.restartSpeech());
    mount3DEditor(el.querySelector('#vn-3d-editor'), _state, (config, models) => {
      if (!game.user?.isGM) return;
      _state.scene3d = config;
      for (const item of models) {
        const char = _state.chars.find(c => c.id === item.id);
        const local = this._chars.find(c => c.id === item.id);
        if (char) { char.model3d = item.model3d; char.locked = item.model3d.locked; }
        if (local) { local.model3d = deepClone(item.model3d); local.locked = item.model3d.locked; }
      }
      DDVNManager.broadcast();
      this.render(); // Refresh actor spawnpoint choices after adding/removing spawn markers.
    }, (patch, key, live) => DDVNManager.edit3D(patch, key, live, true));

    // Force launch button color — Foundry core CSS overrides inline styles and !important
    // so we apply via JS after all framework initialization is done.
    requestAnimationFrame(() => {
      const launchBtn = el.querySelector('[data-action="vn-open"]');
      if (launchBtn) {
        launchBtn.style.setProperty('background', '#16a34a', 'important');
        launchBtn.style.setProperty('color', '#ffffff', 'important');
        launchBtn.style.setProperty('border', 'none', 'important');
        launchBtn.style.setProperty('box-shadow', '0 2px 10px rgba(22,163,74,.45)', 'important');
      }
      // Force dialogue "Show" button — Foundry overrides make it transparent otherwise
      const dlgShowBtn = el.querySelector('[data-action="vn-dlg-show"]');
      if (dlgShowBtn) {
        dlgShowBtn.style.setProperty('background', '#f59e0b', 'important');
        dlgShowBtn.style.setProperty('color', '#0e0e10', 'important');
        dlgShowBtn.style.setProperty('border', 'none', 'important');
        dlgShowBtn.style.setProperty('font-weight', '700', 'important');
        dlgShowBtn.style.setProperty('opacity', '1', 'important');
        dlgShowBtn.style.setProperty('cursor', 'pointer', 'important');
      }
      // Force mic start/stop buttons — same Foundry-button override fights .vn-btn-primary
      const micStartBtn = el.querySelector('[data-action="vn-mic-start"]');
      if (micStartBtn) {
        micStartBtn.style.setProperty('background', '#f59e0b', 'important');
        micStartBtn.style.setProperty('color', '#0e0e10', 'important');
        micStartBtn.style.setProperty('border', 'none', 'important');
        micStartBtn.style.setProperty('font-weight', '700', 'important');
        micStartBtn.style.setProperty('opacity', '1', 'important');
        micStartBtn.style.setProperty('cursor', 'pointer', 'important');
      }
      const micStopBtn = el.querySelector('[data-action="vn-mic-stop"]');
      if (micStopBtn) {
        micStopBtn.style.setProperty('background', 'rgba(220,38,38,.18)', 'important');
        micStopBtn.style.setProperty('color', '#f87171', 'important');
        micStopBtn.style.setProperty('border', '1px solid rgba(220,38,38,.5)', 'important');
        micStopBtn.style.setProperty('opacity', '1', 'important');
        micStopBtn.style.setProperty('cursor', 'pointer', 'important');
      }
    });

    // ── Vertical sidebar tab switching ────────────────────────────────────
    el.querySelectorAll('.vn-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._activeTab = btn.dataset.vtab;
        el.querySelectorAll('.vn-nav-btn').forEach(b => b.classList.toggle('active', b === btn));
        el.querySelectorAll('.vn-tab-content').forEach(c =>
          c.classList.toggle('dd-hidden', c.dataset.vtabContent !== this._activeTab));
      });
    });
    const activeNavBtn = el.querySelector(`.vn-nav-btn[data-vtab="${this._activeTab}"]`);
    if (activeNavBtn) activeNavBtn.click();

    el.querySelector('[data-action="vn-open"]')?.addEventListener('click', () => {
      DDVNManager.open(); this.render();
    });
    el.querySelector('[data-action="vn-open-map"]')?.addEventListener('click', () => DDVNManager.launchWithMapCharacters());
    el.querySelector('[data-action="vn-open-local"]')?.addEventListener('click', () => {
      DDVNManager.openLocal(); this.render();
    });
    el.querySelector('[data-action="vn-close"]')?.addEventListener('click', () => {
      DDVNManager.stop(true); this.render();
    });

    el.querySelector('#vn-bg-path')?.addEventListener('change', e => {
      DDVNManager.setBackground(e.target.value);
    });
    el.querySelector('[data-action="vn-browse-bg"]')?.addEventListener('click', () => {
      this._openFilePicker('imagevideo', p => {
        console.log('DD VN | vn-browse-bg callback, path:', p);
        const inp = el.querySelector('#vn-bg-path');
        console.log('DD VN | input element:', inp);
        if (inp) {
          inp.value = p;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        DDVNManager.setBackground(p);
      });
    });
    el.querySelector('#vn-bg-fit')?.addEventListener('change', e => {
      Object.assign(_state, { bgFit: e.target.value });
      DDVNManager.broadcast();
    });
    el.querySelector('#vn-bg-color')?.addEventListener('change', e => {
      DDVNManager.broadcast({ bgColor: e.target.value });
    });
    el.querySelector('#vn-dim')?.addEventListener('input', e => {
      DDVNManager.broadcast({ dimBg: Number(e.target.value) });
      const lbl = el.querySelector('#vn-dim-val');
      if (lbl) lbl.textContent = Number(e.target.value).toFixed(2);
    });

    // Video tile hover — play preview on mouseenter, pause on mouseleave
    el.querySelectorAll('.vn-bg-tile').forEach(tile => {
      const vid = tile.querySelector('.vn-bg-tile-video');
      if (!vid) return;
      tile.addEventListener('mouseenter', () => { vid.play().catch(() => {}); });
      tile.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
    });

    el.querySelectorAll('[data-bg-variant]').forEach(btn => {
      btn.addEventListener('click', () => {
        const src = btn.dataset.bgVariant;
        const inp = el.querySelector('#vn-bg-path');
        if (inp) inp.value = src;
        DDVNManager.setBackground(src);
        el.querySelectorAll('[data-bg-variant]').forEach(b => b.classList.toggle('vn-bg-tile-active', b === btn));
      });
    });

    el.querySelector('#vn-bg-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      el.querySelectorAll('.vn-bg-panel-group').forEach(group => {
        const groupName = (group.dataset.bgGroupName || '').toLowerCase();
        let anyVisible = false;
        group.querySelectorAll('[data-bg-variant]').forEach(tile => {
          const tileName = (tile.dataset.bgVariantName || '').toLowerCase();
          const match = !q || groupName.includes(q) || tileName.includes(q);
          tile.style.display = match ? '' : 'none';
          if (match) anyVisible = true;
        });
        group.style.display = anyVisible ? '' : 'none';
        if (anyVisible && q) group.open = true;
      });
    });

    el.querySelector('[data-action="vn-bg-add-folder"]')?.addEventListener('click', () => {
      this._importBgFromFolder(el);
    });

    el.querySelector('[data-action="vn-bg-add"]')?.addEventListener('click', () => {
      this._showBgEditForm(el);
    });
    el.querySelectorAll('[data-bg-edit]').forEach(btn => {
      btn.addEventListener('click', () => this._showBgEditForm(el, btn.dataset.bgEdit));
    });
    el.querySelectorAll('[data-bg-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.bgDelete;
        if (!id) return;
        await DDVNPresets.deleteBg(id);
        this.render();
      });
    });
    // Note: vn-bg-edit-save and vn-bg-edit-cancel listeners are bound
    // inside _showBgEditForm when the modal overlay is created.

    el.querySelectorAll('[data-bg-move]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [id, dir] = btn.dataset.bgMove.split(':');
        const allCustom = DDVNPresets.listBg();
        const idx = allCustom.findIndex(b => b.id === id);
        if (idx < 0) return;
        const newIdx = dir === 'left' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= allCustom.length) return;
        const raw = DDVNPresets._g(DDVNPresets.BG_KEY);
        const keys = Object.keys(raw);
        const ki = keys.indexOf(id), kj = keys[newIdx];
        [raw[id], raw[kj]] = [raw[kj], raw[id]];
        const reordered = {};
        keys.forEach(k => { reordered[k] = raw[k]; });
        await game.settings.set(MODULE_ID, DDVNPresets.BG_KEY, reordered);
        this.render();
      });
    });

    this._bindCharEvents(el);
    this._bindTextPicsEvents(el);

    el.querySelector('[data-action="vn-chars-save"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#vn-chars-preset-name')?.value?.trim();
      if (!name) return;
      await DDVNPresets.saveChars(name, deepClone(this._chars));
      ui.notifications.info(game.i18n.format('DRAMADIRECTOR.notifications.rosterSaved', {name}));
      this.render();
    });
    el.querySelector('[data-action="vn-chars-load"]')?.addEventListener('click', () => {
      const n = el.querySelector('#vn-chars-preset-select')?.value;
      const c = DDVNPresets.getChars(n);
      if (!c) return;
      this._chars = deepClone(c);
      DDVNManager.setChars(this._chars);
      this.render();
    });
    el.querySelector('[data-action="vn-chars-delete"]')?.addEventListener('click', async () => {
      const n = el.querySelector('#vn-chars-preset-select')?.value;
      if (!n) return;
      await DDVNPresets.deleteChars(n);
      this.render();
    });

    // Presets tab duplicates (same logic, different input IDs)
    el.querySelector('[data-action="vn-chars-save2"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#vn-chars-preset-name2')?.value?.trim();
      if (!name) return;
      await DDVNPresets.saveChars(name, deepClone(this._chars));
      ui.notifications.info(game.i18n.format('DRAMADIRECTOR.notifications.rosterSaved', {name}));
      this.render();
    });
    el.querySelector('[data-action="vn-chars-load2"]')?.addEventListener('click', () => {
      const n = el.querySelector('#vn-chars-preset-select2')?.value;
      const c = DDVNPresets.getChars(n);
      if (!c) return;
      this._chars = deepClone(c);
      DDVNManager.setChars(this._chars);
      this.render();
    });
    el.querySelector('[data-action="vn-chars-delete2"]')?.addEventListener('click', async () => {
      const n = el.querySelector('#vn-chars-preset-select2')?.value;
      if (!n) return;
      await DDVNPresets.deleteChars(n);
      this.render();
    });

    el.querySelector('[data-action="vn-dlg-show"]')?.addEventListener('click', () => {
      const name = el.querySelector('#vn-dlg-name')?.value || '';
      const text = el.querySelector('#vn-dlg-text')?.value || '';
      const color = el.querySelector('#vn-dlg-color')?.value || '#ffe066';
      const auto = Number(el.querySelector('#vn-dlg-auto')?.value) || 0;
      DDVNManager.showDialogue(name, text, color, auto);
    });
    el.querySelector('[data-action="vn-dlg-hide"]')?.addEventListener('click', () => DDVNManager.hideDialogue());
    el.querySelector('[data-action="vn-dlg-active"]')?.addEventListener('click', () => {
      const active = _state.chars.find(c => c.active);
      if (!active) return ui.notifications.warn(game.i18n.localize('DRAMADIRECTOR.notifications.noActiveChar'));
      const text = el.querySelector('#vn-dlg-text')?.value || '';
      DDVNManager.showDialogue(active.name, text, active.nameColor);
    });

    el.querySelector('[data-action="vn-mic-start"]')?.addEventListener('click', async () => {
      await DDVNMic.start(); this.render();
    });
    el.querySelector('[data-action="vn-mic-stop"]')?.addEventListener('click', () => {
      DDVNMic.stop(); this.render();
    });
    el.querySelector('#vn-mic-threshold')?.addEventListener('input', e => {
      DDVNMic.threshold = Number(e.target.value);
      const lbl = el.querySelector('#vn-mic-threshold-val');
      if (lbl) lbl.textContent = e.target.value;
    });
    el.querySelector('#vn-mic-lang')?.addEventListener('change', e => {
      DDVNMic.lang = e.target.value;
      const quickLang = document.getElementById('vn-quick-lang');
      if (quickLang) quickLang.value = e.target.value;
      if (DDVNMic._active) { DDVNMic.stop(); DDVNMic.start(); }
    });

    el.querySelector('#vn-gm-char')?.addEventListener('change', e => {
      this._gmCharId = e.target.value || null;
    });

    el.querySelector('[data-action="vn-scene-save"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#vn-scene-name')?.value?.trim();
      if (!name) return;
      await DDVNPresets.saveScene(name, DDVNPresets.makeSceneSnapshot(_state, true));
      ui.notifications.info(game.i18n.format('DRAMADIRECTOR.notifications.sceneSaved', {name}));
      this.render();
    });
    el.querySelector('[data-action="vn-scene-load"]')?.addEventListener('click', () => {
      const n = el.querySelector('#vn-scene-select')?.value;
      if (!n) return;
      const s = DDVNPresets.getScene(n);
      if (!s) return;
      DDVNManager.applySceneState(s);
      this.render();
      ui.notifications.info(game.i18n.format('DRAMADIRECTOR.notifications.sceneLoaded', {name: n}));
    });
    el.querySelector('[data-action="vn-scene-delete"]')?.addEventListener('click', async () => {
      const n = el.querySelector('#vn-scene-select')?.value;
      if (!n) return;
      await DDVNPresets.deleteScene(n); this.render();
    });

    el.querySelectorAll('.vn-macro-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = btn.closest('.vn-macro-wrap')?.querySelector('.vn-macro-example');
        if (!pre) return;
        navigator.clipboard.writeText(pre.textContent).then(() => {
          btn.innerHTML = '<i class="fas fa-check"></i>';
          setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1500);
        });
      });
    });

    // ── Help sub-tab switching ─────────────────────────────────────────────
    el.querySelectorAll('.vn-help-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.helpTab;
        el.querySelectorAll('.vn-help-tab').forEach(b => b.classList.toggle('active', b === btn));
        el.querySelectorAll('.vn-help-panel').forEach(p => {
          p.style.display = p.dataset.helpPanel === tab ? 'flex' : 'none';
        });
      });
    });

    // ── Per-macro copy buttons ────────────────────────────────────────────
    el.querySelectorAll('.vn-macro-card-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = (btn.dataset.macro || '').replace(/\\n/g, '\n');
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => {
          btn.innerHTML = '<i class="fas fa-check"></i>';
          btn.style.color = '#6f6';
          setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; btn.style.color = ''; }, 1500);
        });
      });
    });

    // Per-emotion chip copy buttons — generate macro with real charId + emoName
    el.querySelectorAll('.vn-macro-chip-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const chip = btn.closest('.vn-macro-emo-chip');
        const charId = chip?.dataset.charId ?? '';
        const emoName = chip?.dataset.emoName ?? '';
        const code = `DDVNApi.setEmotion('${charId}', '${emoName}');`;
        navigator.clipboard.writeText(code).then(() => {
          btn.innerHTML = '<i class="fas fa-check"></i>';
          btn.style.color = '#6f6';
          setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; btn.style.color = ''; }, 1500);
        });
      });
    });

    // Whole-chip click (not on the copy button) — copy setEmotion macro
    el.querySelectorAll('.vn-macro-emo-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.vn-macro-chip-copy')) return;
        const charId = chip.dataset.charId ?? '';
        const emoName = chip.dataset.emoName ?? '';
        const code = `DDVNApi.setEmotion('${charId}', '${emoName}');`;
        navigator.clipboard.writeText(code).then(() => {
          chip.classList.add('vn-macro-chip-copied');
          setTimeout(() => chip.classList.remove('vn-macro-chip-copied'), 1200);
        });
      });
    });

    // Reset emotion buttons
    el.querySelectorAll('.vn-macro-reset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const charId = btn.dataset.charId ?? '';
        const code = `DDVNApi.resetEmotion('${charId}');`;
        navigator.clipboard.writeText(code).then(() => {
          btn.innerHTML = '<i class="fas fa-check"></i>';
          btn.style.background = 'rgba(74,222,128,.2)';
          btn.style.borderColor = 'rgba(74,222,128,.5)';
          btn.style.color = '#4ade80';
          setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-undo"></i>';
            btn.style.background = '';
            btn.style.borderColor = '';
            btn.style.color = '';
          }, 1400);
        });
      });
    });

    // Click on ID badge copies just the char ID
    el.querySelectorAll('.vn-macro-id-badge[data-copy-id]').forEach(badge => {
      badge.addEventListener('click', () => {
        navigator.clipboard.writeText(badge.dataset.copyId).then(() => {
          const orig = badge.textContent;
          badge.textContent = '✓ скопировано';
          badge.style.color = '#4ade80';
          setTimeout(() => { badge.textContent = orig; badge.style.color = ''; }, 1200);
        });
      });
    });
  }

  _bindTextPicsEvents(el) {
    el.querySelector('[data-action="vn-layer-add-img"]')?.addEventListener('click', () => {
      this._layers.push(newLayer('image'));
      DDVNManager.setLayers(this._layers);
      this.render();
    });
    el.querySelector('[data-action="vn-layer-add-text"]')?.addEventListener('click', () => {
      this._layers.push(newLayer('text'));
      DDVNManager.setLayers(this._layers);
      this.render();
    });

    el.querySelectorAll('[data-layer-idx]').forEach(row => {
      const idx = Number(row.dataset.layerIdx);
      const layer = this._layers[idx];
      if (!layer) return;

      row.querySelector('[data-layer-action="remove"]')?.addEventListener('click', () => {
        this._layers.splice(idx, 1);
        DDVNManager.setLayers(this._layers);
        this.render();
      });
      row.querySelector('[data-layer-action="move-up"]')?.addEventListener('click', () => {
        if (idx > 0) {
          [this._layers[idx-1], this._layers[idx]] = [this._layers[idx], this._layers[idx-1]];
          DDVNManager.setLayers(this._layers); this.render();
        }
      });
      row.querySelector('[data-layer-action="move-down"]')?.addEventListener('click', () => {
        if (idx < this._layers.length - 1) {
          [this._layers[idx], this._layers[idx+1]] = [this._layers[idx+1], this._layers[idx]];
          DDVNManager.setLayers(this._layers); this.render();
        }
      });
      row.querySelector('[data-layer-action="browse"]')?.addEventListener('click', () => {
        this._openFilePicker(layer.type === 'image' ? 'image' : 'any', p => {
          console.log('DD VN | layer browse callback, path:', p);
          this._layers[idx].src = p;
          const inp = row.querySelector('.vn-layer-src-inp');
          if (inp) {
            inp.value = p;
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          DDVNManager.setLayers(this._layers);
        });
      });

      row.querySelectorAll('input, select, textarea').forEach(inp => {
        inp.addEventListener('change', () => this._syncLayerRow(idx, row));
        inp.addEventListener('input', () => this._syncLayerRow(idx, row));
      });

      // Tag input for this layer row
      const tagWrap = row.querySelector('.vn-layer-tags-wrap');
      if (tagWrap) {
        this._bindTagInput(tagWrap,
          () => this._layers[idx]?.tags ?? [],
          (tags) => {
            if (this._layers[idx]) {
              this._layers[idx].tags = tags;
              DDVNManager.setLayers(this._layers);
            }
          }
        );
      }
    });

    el.querySelector('[data-action="vn-layers-save"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#vn-layers-preset-name')?.value?.trim();
      if (!name) return;
      // Save only transform snapshot, not full object definitions
      await DDVNPresets.saveLayers(name, DDVNPresets.toTransformSnapshot(this._layers));
      ui.notifications.info(`Layers preset "${name}" saved.`);
      this.render();
    });
    el.querySelector('[data-action="vn-layers-load"]')?.addEventListener('click', () => {
      const n = el.querySelector('#vn-layers-preset-select')?.value;
      const snapshot = DDVNPresets.getLayers(n);
      if (!snapshot) return;
      // Apply transforms to master list — objects not in snapshot remain unchanged
      this._layers = DDVNPresets.applyTransformSnapshot(this._layers, snapshot);
      DDVNManager.setLayers(this._layers);
      this.render();
    });
    el.querySelector('[data-action="vn-layers-delete"]')?.addEventListener('click', async () => {
      const n = el.querySelector('#vn-layers-preset-select')?.value;
      if (!n) return;
      await DDVNPresets.deleteLayers(n); this.render();
    });

    // Presets tab layer duplicates
    el.querySelector('[data-action="vn-layers-save2"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#vn-layers-preset-name2')?.value?.trim();
      if (!name) return;
      await DDVNPresets.saveLayers(name, DDVNPresets.toTransformSnapshot(this._layers));
      ui.notifications.info(`Layers preset "${name}" saved.`);
      this.render();
    });
    el.querySelector('[data-action="vn-layers-load2"]')?.addEventListener('click', () => {
      const n = el.querySelector('#vn-layers-preset-select2')?.value;
      const snapshot = DDVNPresets.getLayers(n);
      if (!snapshot) return;
      this._layers = DDVNPresets.applyTransformSnapshot(this._layers, snapshot);
      DDVNManager.setLayers(this._layers);
      this.render();
    });
    el.querySelector('[data-action="vn-layers-delete2"]')?.addEventListener('click', async () => {
      const n = el.querySelector('#vn-layers-preset-select2')?.value;
      if (!n) return;
      await DDVNPresets.deleteLayers(n); this.render();
    });
    el.querySelector('[data-action="vn-layers-macro"]')?.addEventListener('click', () => {
      const code = `// Apply VN layers
const layers = ${JSON.stringify(this._layers, null, 2)};
game.modules.get('drama-director-novella').api.setLayers(layers);`;
      const wrap = el.querySelector('#vn-layers-macro-wrap');
      if (wrap) { wrap.style.display = ''; wrap.querySelector('.vn-macro-example').textContent = code; }
    });
    el.querySelector('[data-action="vn-layers-clear"]')?.addEventListener('click', () => {
      this._layers = [];
      DDVNManager.setLayers(this._layers);
      this.render();
    });

    el.querySelector('[data-action="vn-iimg-add"]')?.addEventListener('click', () => {
      this._interactiveImages.push(newInteractiveImage());
      DDVNManager.setInteractiveImages(this._interactiveImages);
      this.render();
    });

    el.querySelectorAll('[data-iimg-idx]').forEach(row => {
      const idx = Number(row.dataset.iimgIdx);
      if (!this._interactiveImages[idx]) return;

      row.querySelector('[data-iimg-action="remove"]')?.addEventListener('click', () => {
        this._interactiveImages.splice(idx, 1);
        DDVNManager.setInteractiveImages(this._interactiveImages);
        this.render();
      });
      row.querySelector('[data-iimg-action="browse"]')?.addEventListener('click', () => {
        this._openFilePicker('image', p => {
          console.log('DD VN | iimg browse callback, path:', p);
          this._interactiveImages[idx].src = p;
          const inp = row.querySelector('.vn-iimg-src-inp');
          if (inp) {
            inp.value = p;
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          DDVNManager.setInteractiveImages(this._interactiveImages);
        });
      });

      row.querySelector('[data-iimg-action="browse-hover"]')?.addEventListener('click', () => {
        this._openFilePicker('image', p => {
          this._interactiveImages[idx].hoverSrc = p;
          const inp = row.querySelector('.vn-iimg-hover-src-inp');
          if (inp) { inp.value = p; inp.dispatchEvent(new Event('change', { bubbles: true })); }
          DDVNManager.setInteractiveImages(this._interactiveImages);
        });
      });

      row.querySelectorAll('input, select').forEach(inp => {
        inp.addEventListener('change', () => this._syncIimgRow(idx, row));
        inp.addEventListener('input', () => this._syncIimgRow(idx, row));

        // Взаимоисключающие чекбоксы hover/click
        const cbHover = row.querySelector('.vn-iimg-trigger-hover');
        const cbClick = row.querySelector('.vn-iimg-trigger-click');
        if (cbHover && cbClick) {
          cbHover.addEventListener('change', () => { if (cbHover.checked) cbClick.checked = false; this._syncIimgRow(idx, row); });
          cbClick.addEventListener('change', () => { if (cbClick.checked) cbHover.checked = false; this._syncIimgRow(idx, row); });
        }
      });
    });

    el.querySelector('[data-action="vn-iimg-save"]')?.addEventListener('click', async () => {
      const name = el.querySelector('#vn-iimg-preset-name')?.value?.trim();
      if (!name) return;
      await DDVNPresets.saveIimgs(name, DDVNPresets.toTransformSnapshot(this._interactiveImages));
      ui.notifications.info(`Interactive images preset "${name}" saved.`);
      this.render();
    });
    el.querySelector('[data-action="vn-iimg-load"]')?.addEventListener('click', () => {
      const n = el.querySelector('#vn-iimg-preset-select')?.value;
      const snapshot = DDVNPresets.getIimgs(n);
      if (!snapshot) return;
      this._interactiveImages = DDVNPresets.applyTransformSnapshot(this._interactiveImages, snapshot);
      DDVNManager.setInteractiveImages(this._interactiveImages);
      this.render();
    });
    el.querySelector('[data-action="vn-iimg-delete"]')?.addEventListener('click', async () => {
      const n = el.querySelector('#vn-iimg-preset-select')?.value;
      if (!n) return;
      await DDVNPresets.deleteIimgs(n); this.render();
    });
    el.querySelector('[data-action="vn-iimg-macro"]')?.addEventListener('click', () => {
      const code = `// Apply VN interactive images
const images = ${JSON.stringify(this._interactiveImages, null, 2)};
game.modules.get('drama-director-novella').api.setInteractiveImages(images);`;
      const wrap = el.querySelector('#vn-iimg-macro-wrap');
      if (wrap) { wrap.style.display = ''; wrap.querySelector('.vn-macro-example').textContent = code; }
    });
    el.querySelector('[data-action="vn-iimg-clear"]')?.addEventListener('click', () => {
      this._interactiveImages = [];
      DDVNManager.setInteractiveImages(this._interactiveImages);
      this.render();
    });
  }

  _syncLayerRow(idx, row) {
    const l = this._layers[idx];
    if (!l) return;
    const q = s => row.querySelector(s);
    l.name = q('.vn-layer-name-inp')?.value ?? l.name;
    l.src = q('.vn-layer-src-inp')?.value ?? l.src;
    l.text = q('.vn-layer-text-inp')?.value ?? l.text;
    l.x = Number(q('.vn-layer-x')?.value) || 0;
    l.y = Number(q('.vn-layer-y')?.value) || 0;
    l.zIndex = Number(q('.vn-layer-z')?.value) || 0;
    l.width = Number(q('.vn-layer-w')?.value) || 300;
    l.height = Number(q('.vn-layer-h')?.value) || 200;
    l.opacity = parseFloat(q('.vn-layer-opacity')?.value ?? 1);
    l.baseScale = parseFloat(q('.vn-layer-scale')?.value ?? 1);
    // В режиме глубины — пересчитываем
    if (_state.depthMode) {
      l.scale  = parseFloat((l.baseScale * DDVNOverlay._perspectiveFactor(DDVNOverlay._depthY('layer', l))).toFixed(3));
      l.zIndex = DDVNOverlay._depthZ('layer', l);
    } else {
      l.scale = l.baseScale;
    }
    l.fontSize = Number(q('.vn-layer-fontsize')?.value) || 28;
    l.color = q('.vn-layer-color')?.value ?? l.color;
    l.textAlign = q('.vn-layer-align')?.value ?? l.textAlign;
    l.visible = q('.vn-layer-visible')?.checked !== false;
    l.animIn  = q('.vn-layer-anim-in')?.value  ?? l.animIn  ?? 'fade';
    l.animOut = q('.vn-layer-anim-out')?.value ?? l.animOut ?? 'fade';
    ['.vn-layer-x', '.vn-layer-y', '.vn-layer-z', '.vn-layer-w', '.vn-layer-h', '.vn-layer-opacity', '.vn-layer-scale', '.vn-layer-fontsize'].forEach(sel => {
      const inp = q(sel);
      if (inp?.nextElementSibling?.classList.contains('vn-slider-val')) {
        inp.nextElementSibling.textContent = inp.value;
      }
    });
    DDVNManager.setLayers(this._layers);
  }

  _syncIimgRow(idx, row) {
    const img = this._interactiveImages[idx];
    if (!img) return;
    const q = s => row.querySelector(s);
    img.name    = q('.vn-iimg-name-inp')?.value      ?? img.name;
    img.src     = q('.vn-iimg-src-inp')?.value       ?? img.src;
    img.hoverSrc = q('.vn-iimg-hover-src-inp')?.value ?? img.hoverSrc ?? '';
    img.macroId = q('.vn-iimg-macro-sel')?.value      ?? img.macroId;
    img.triggerOnHover = q('.vn-iimg-trigger-hover')?.checked ?? false;
    img.triggerOnClick = q('.vn-iimg-trigger-click')?.checked ?? true;
    img.x = Number(q('.vn-iimg-x')?.value) || 0;
    img.y = Number(q('.vn-iimg-y')?.value) || 0;
    img.zIndex = Number(q('.vn-iimg-z')?.value) || 0;
    img.width = Number(q('.vn-iimg-w')?.value) || 200;
    img.height = Number(q('.vn-iimg-h')?.value) || 200;
    img.opacity = parseFloat(q('.vn-iimg-opacity')?.value ?? 1);
    img.baseScale = parseFloat(q('.vn-iimg-scale')?.value ?? 1);
    // В режиме глубины — пересчитываем
    if (_state.depthMode) {
      img.scale  = parseFloat((img.baseScale * DDVNOverlay._perspectiveFactor(DDVNOverlay._depthY('interactive', img))).toFixed(3));
      img.zIndex = DDVNOverlay._depthZ('interactive', img);
    } else {
      img.scale = img.baseScale;
    }
    img.visible = q('.vn-iimg-visible')?.checked !== false;
    img.animIn  = q('.vn-iimg-anim-in')?.value  ?? img.animIn  ?? 'fade';
    img.animOut = q('.vn-iimg-anim-out')?.value ?? img.animOut ?? 'fade';
    ['.vn-iimg-x', '.vn-iimg-y', '.vn-iimg-z', '.vn-iimg-w', '.vn-iimg-h', '.vn-iimg-opacity', '.vn-iimg-scale'].forEach(sel => {
      const inp = q(sel);
      if (inp?.nextElementSibling?.classList.contains('vn-slider-val')) {
        inp.nextElementSibling.textContent = inp.value;
      }
    });
    DDVNManager.setInteractiveImages(this._interactiveImages);
  }

  _syncCharsFromState() {
    this._chars = deepClone(_state.chars);
    // Ensure emotions array exists on all chars (backward compat)
    this._chars.forEach(c => {
      if (!c.emotions) c.emotions = [];
      if (!c.activeEmotion) c.activeEmotion = '';
      if (!('_baseImg' in c)) c._baseImg = '';
      c.emotions.forEach(e => { if (!('emoji' in e)) e.emoji = ''; if (!('macroId' in e)) e.macroId = ''; });
    });
    this._layers = deepClone(_state.layers);
    this._interactiveImages = deepClone(_state.interactiveImages);
  }

  _bindCharEvents(el) {
    // ── Toolbar: deactivate all, infinite roster toggle ──────────────────
    el.querySelector('[data-action="vn-deactivate-all"]')?.addEventListener('click', () => {
      DDVNManager.deactivateAll();
      this.render();
    });

    // Panel-level infinite-roster toggle removed — infinite is the only mode.

    // ── Add char button (infinite-roster only: single button) ────────────
    const addChar = (side) => {
      const char = newChar(side, this._chars.filter(c => c.side === side).length);
      this._refreshPositionsFromState();
      this._chars.push(char);
      DDVNManager.setChars(this._chars);
      if (game.user?.isGM) {
        DDVNPresets.saveChars('InfiniteRoaster', deepClone(this._chars));
      }
      this._selectedCharId = char.id;
      this.render();
    };

    el.querySelector('[data-action="vn-char-add-any"]')?.addEventListener('click', () => addChar('center'));

    // ── Search ───────────────────────────────────────────────────────────
    el.querySelector('#vn-char-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('.vn-char-card').forEach(card => {
        const name = (card.dataset.charName || '').toLowerCase();
        card.style.display = !q || name.includes(q) ? '' : 'none';
      });
    });

    // ── Card click → open inspector ───────────────────────────────────────
    el.querySelectorAll('.vn-char-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.vn-card-btn')) return;
        const charId = card.dataset.charId;
        this._selectedCharId = charId;

        // Highlight selected card
        el.querySelectorAll('.vn-char-card').forEach(c => c.classList.toggle('vn-card-selected', c.dataset.charId === charId));

        // Show correct inspector body
        el.querySelector('#vn-char-inspector-empty')?.classList.add('dd-hidden');
        el.querySelectorAll('.vn-char-inspector-body').forEach(body => {
          const show = body.dataset.inspectorFor === charId;
          body.classList.toggle('dd-hidden', !show);
        });
      });

      // Quick action buttons on the card itself
      const charId  = card.dataset.charId;
      const charIdx = Number(card.dataset.charIdx);
      const char    = this._chars[charIdx];
      if (!char) return;

      card.querySelector('[data-char-action="active"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._refreshPositionsFromState();
        this._chars.forEach((c, i) => { c.active = i === charIdx ? !c.active : false; });
        DDVNManager.setChars(this._chars);
        this.render();
        // Re-select the card after render
        this._selectedCharId = charId;
      });

      card.querySelector('[data-char-action="remove"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._refreshPositionsFromState();
        this._chars.splice(charIdx, 1);
        this._recalcSlots();
        if (this._selectedCharId === charId) this._selectedCharId = null;
        DDVNManager.setChars(this._chars);
        if (game.user?.isGM) {
          DDVNPresets.saveChars('InfiniteRoaster', deepClone(this._chars));
        }
        this.render();
      });
    });

    // Restore selected card highlight and inspector after render
    if (this._selectedCharId) {
      const card = el.querySelector(`.vn-char-card[data-char-id="${this._selectedCharId}"]`);
      if (card) {
        card.classList.add('vn-card-selected');
        el.querySelector('#vn-char-inspector-empty')?.classList.add('dd-hidden');
        const body = el.querySelector(`.vn-char-inspector-body[data-inspector-for="${this._selectedCharId}"]`);
        if (body) body.classList.remove('dd-hidden');
      }
    }

    // ── Inspector bodies ──────────────────────────────────────────────────
    el.querySelectorAll('.vn-char-inspector-body').forEach(insp => {
      const idx  = Number(insp.dataset.charIdx);
      const char = this._chars[idx];
      if (!char) return;

      // All inputs/selects sync on change/input
      insp.querySelectorAll('input:not([type=checkbox]):not([type=color])').forEach(inp => {
        inp.addEventListener('input', () => this._syncCharInspector(idx, insp));
      });
      insp.querySelectorAll('input[type=checkbox]').forEach(inp => {
        inp.addEventListener('change', () => this._syncCharInspector(idx, insp));
      });
      insp.querySelectorAll('input[type=color]').forEach(inp => {
        inp.addEventListener('input', () => this._syncCharInspector(idx, insp));
      });
      insp.querySelectorAll('select').forEach(sel => {
        sel.addEventListener('change', () => {
          if (sel.classList.contains('vn-char-player') && sel.value) {
            this._chars.forEach((other, otherIdx) => {
              if (otherIdx !== idx && other.playerId === sel.value) {
                other.playerId = null;
                const otherInsp = el.querySelector(`.vn-char-inspector-body[data-char-idx="${otherIdx}"]`);
                const otherSel  = otherInsp?.querySelector('.vn-char-player');
                if (otherSel) otherSel.value = '';
              }
            });
          }
          this._syncCharInspector(idx, insp);
        });
      });

      // Action buttons inside inspector
      insp.querySelectorAll('[data-char-action]').forEach(btn => {
        const action = btn.dataset.charAction;
        btn.addEventListener('click', () => {
          if (action === 'switch-side') {
            const sides = ['left', 'center', 'right'];
            char.side = sides[(sides.indexOf(char.side) + 1) % sides.length];
            this._refreshPositionsFromState();
            this._recalcSlots();
            DDVNManager.setChars(this._chars);
            this._selectedCharId = char.id;
            this.render();
          } else if (action === 'move-up') {
            const same = this._chars.filter(c => c.side === char.side);
            const si   = same.indexOf(char);
            if (si > 0) { [same[si].slot, same[si-1].slot] = [same[si-1].slot, same[si].slot]; this._sortChars(); DDVNManager.setChars(this._chars); }
            this._selectedCharId = char.id;
            this.render();
          } else if (action === 'move-down') {
            const same = this._chars.filter(c => c.side === char.side);
            const si   = same.indexOf(char);
            if (si < same.length - 1) { [same[si].slot, same[si+1].slot] = [same[si+1].slot, same[si].slot]; this._sortChars(); DDVNManager.setChars(this._chars); }
            this._selectedCharId = char.id;
            this.render();
          } else if (action === 'add-emotion') {
            if (!char.emotions) char.emotions = [];
            char.emotions.push({ name: '', img: '', macroId: '' });
            DDVNManager.setChars(this._chars);
            this._selectedCharId = char.id;
            this.render();
          } else if (action === 'remove-emotion') {
            const emoIdx = parseInt(btn.dataset.emoIdx ?? '0');
            if (!char.emotions) char.emotions = [];
            const removedName = char.emotions[emoIdx]?.name;
            char.emotions.splice(emoIdx, 1);
            if (char.activeEmotion && !char.emotions.find(e => e.name === char.activeEmotion)) char.activeEmotion = '';
            if (removedName) DDVNEmotionManager.removeFavorite(char.id, removedName);
            DDVNManager.setChars(this._chars);
            this._selectedCharId = char.id;
            this.render();
          } else if (action === 'apply-emotion') {
            const emoIdx = parseInt(btn.dataset.emoIdx ?? '0');
            const emo    = char.emotions?.[emoIdx];
            if (!emo) return;
            this._applyEmotion(char.id, char.activeEmotion === emo.name ? '' : emo.name);
            this._selectedCharId = char.id;
            this.render();
          } else if (action === 'browse') {
            this._openFilePicker('imagevideo', p => {
              char.img = p;
              const inp = insp.querySelector('.vn-char-img-inp');
              if (inp) inp.value = p;
              DDVNManager.setChars(this._chars);
              this._selectedCharId = char.id;
              this.render();
            });
          } else if (action === 'browse-active') {
            this._openFilePicker('imagevideo', p => {
              char.activeImg = p;
              const inp = insp.querySelector('.vn-char-active-img-inp');
              if (inp) inp.value = p;
              DDVNManager.setChars(this._chars);
              this._selectedCharId = char.id;
              this.render();
            });
          } else if (action === 'browse-emotion') {
            const emoIdx = parseInt(btn.dataset.emoIdx ?? '0');
            this._openFilePicker('imagevideo', p => {
              if (!char.emotions) char.emotions = [];
              if (!char.emotions[emoIdx]) char.emotions[emoIdx] = { name: '', img: '' };
              char.emotions[emoIdx].img = p;
              const inp = insp.querySelector(`.vn-char-emo-img-inp[data-emo-idx="${emoIdx}"]`);
              if (inp) inp.value = p;
              DDVNManager.setChars(this._chars);
            });
          } else if (action === 'browse-hover') {
            this._openFilePicker('imagevideo', p => {
              char.hoverSrc = p;
              const inp = insp.querySelector('.vn-char-hover-src-inp');
              if (inp) inp.value = p;
              DDVNManager.setChars(this._chars);
              this._selectedCharId = char.id;
              this.render();
            });
          }
        });
      });

      // Tag input for this char
      const tagWrap = insp.querySelector('[data-char-tags]');
      if (tagWrap) {
        this._bindTagInput(tagWrap,
          () => this._chars[idx]?.tags ?? [],
          (tags) => {
            if (this._chars[idx]) {
              this._chars[idx].tags = tags;
              DDVNManager.setChars(this._chars);
            }
          }
        );
      }
    });
  }

  /** Sync inspector form data → this._chars[idx] → broadcast */
  /** Bind a tag-chip input widget. onchange(tags[]) called whenever tags change. */
  _bindTagInput(container, getTags, setTags) {
    const chipsRow = container.querySelector('.vn-tag-chips-row');
    const inp      = container.querySelector('.vn-tag-inp');
    if (!inp || !chipsRow) return;

    const refresh = () => {
      const tags = getTags();
      chipsRow.innerHTML = (tags || []).map(t =>
        `<span class="vn-tag-chip">${t}<button class="vn-tag-chip-del" data-tag="${t}" tabindex="-1">×</button></span>`
      ).join('');
      chipsRow.querySelectorAll('.vn-tag-chip-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const current = getTags();
          setTags(current.filter(t => t !== btn.dataset.tag));
          refresh();
        });
      });
    };

    // Delete chips already rendered by HBS
    container.querySelectorAll('.vn-tag-chip-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = getTags();
        setTags(current.filter(t => t !== btn.dataset.tag));
        refresh();
      });
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ',') return;
      e.preventDefault();
      const val = inp.value.trim().toLowerCase().replace(/[^a-zа-яё0-9_\-]/gi, '');
      if (!val) return;
      const current = getTags();
      if (!current.includes(val)) setTags([...current, val]);
      inp.value = '';
      refresh();
    });
  }

  _syncCharInspector(idx, insp) {
    const c = this._chars[idx];
    if (!c) return;

    this._refreshPositionsFromState();

    c.name      = insp.querySelector('.vn-char-name-inp')?.value      ?? c.name;
    c.nameColor = insp.querySelector('.vn-char-ncolor')?.value        ?? c.nameColor;
    c.title     = insp.querySelector('.vn-char-title-inp')?.value     ?? c.title;
    c.img       = insp.querySelector('.vn-char-img-inp')?.value       ?? c.img;
    c.activeImg = insp.querySelector('.vn-char-active-img-inp')?.value ?? c.activeImg;

    if (!c.emotions) c.emotions = [];
    insp.querySelectorAll('.vn-char-emo-row').forEach((emoRow, ei) => {
      if (!c.emotions[ei]) c.emotions[ei] = { name: '', img: '', macroId: '' };
      const nameInp  = emoRow.querySelector('.vn-char-emo-name-inp');
      const imgInp   = emoRow.querySelector('.vn-char-emo-img-inp');
      const macroSel = emoRow.querySelector('.vn-char-emo-macro-sel');
      if (nameInp)  c.emotions[ei].name    = nameInp.value;
      if (imgInp)   c.emotions[ei].img     = imgInp.value;
      if (macroSel) c.emotions[ei].macroId = macroSel.value;
    });

    c.baseScale = parseFloat(insp.querySelector('.vn-char-scale')?.value) || 1;
    c.x         = Number(insp.querySelector('.vn-char-x')?.value)    || 0;
    c.y         = Number(insp.querySelector('.vn-char-y')?.value)    || 0;
    c.zIndex    = Number(insp.querySelector('.vn-char-z')?.value)    || 0;
    c.mirror    = insp.querySelector('.vn-char-mirror')?.checked  ?? false;
    c.visible   = insp.querySelector('.vn-char-visible')?.checked ?? true;

    c.playerId = insp.querySelector('.vn-char-player')?.value || null;
    if (c.playerId) {
      this._chars.forEach((other, i) => {
        if (i !== idx && other.playerId === c.playerId) other.playerId = null;
      });
    }
    c.locked = insp.querySelector('.vn-char-locked')?.checked ?? false;
    c.actorId = insp.querySelector('.vn-char-actor')?.value || '';
    c.tokenUuid = insp.querySelector('.vn-char-token')?.value || '';
    c.spawnpointId = insp.querySelector('.vn-char-spawnpoint')?.value || '';
    if (c.model3d) c.model3d.locked = c.locked;

    // Interactive fields
    c.macroId = insp.querySelector('.vn-char-macro-sel')?.value ?? c.macroId ?? '';
    c.animIn  = insp.querySelector('.vn-char-anim-in')?.value  ?? c.animIn  ?? 'fade';
    c.animOut = insp.querySelector('.vn-char-anim-out')?.value ?? c.animOut ?? 'fade';

    if (_state.depthMode) {
      c.scale  = parseFloat((c.baseScale * DDVNOverlay._perspectiveFactor(DDVNOverlay._depthY('char', c))).toFixed(3));
      c.zIndex = DDVNOverlay._depthZ('char', c);
    } else {
      c.scale = c.baseScale;
    }

    DDVNManager.setChars(this._chars);
  }

  _syncCharRow(idx, row) {
    const c = this._chars[idx];
    if (!c) return;

    // Подтягиваем позиции ВСЕХ персонажей из _state — чтобы не затереть
    // результат дрэга при движении слайдера другого персонажа.
    this._refreshPositionsFromState();

    c.name = row.querySelector('.vn-char-name-inp')?.value ?? c.name;
    c.nameColor = row.querySelector('.vn-char-ncolor')?.value ?? c.nameColor;
    c.title = row.querySelector('.vn-char-title-inp')?.value ?? c.title;
    c.img = row.querySelector('.vn-char-img-inp')?.value ?? c.img;
    c.activeImg = row.querySelector('.vn-char-active-img-inp')?.value ?? c.activeImg;
    // Sync emotions
    if (!c.emotions) c.emotions = [];
    row.querySelectorAll('.vn-char-emo-row').forEach((emoRow, ei) => {
      if (!c.emotions[ei]) c.emotions[ei] = { name:'', emoji:'', img:'', macroId:'' };
      const nameInp  = emoRow.querySelector('.vn-char-emo-name-inp');
      const imgInp   = emoRow.querySelector('.vn-char-emo-img-inp');
      const macroSel = emoRow.querySelector('.vn-char-emo-macro-sel');
      if (nameInp)  c.emotions[ei].name    = nameInp.value;
      if (imgInp)   c.emotions[ei].img     = imgInp.value;
      if (macroSel) c.emotions[ei].macroId = macroSel.value;
    });
    c.baseScale = parseFloat(row.querySelector('.vn-char-scale')?.value) || 1;
    c.x = Number(row.querySelector('.vn-char-x')?.value) || 0;
    c.y = Number(row.querySelector('.vn-char-y')?.value) || 0;
    c.zIndex = Number(row.querySelector('.vn-char-z')?.value) || 0;
    c.mirror = row.querySelector('.vn-char-mirror')?.checked ?? false;
    c.visible = row.querySelector('.vn-char-visible')?.checked ?? true;
    c.playerId = row.querySelector('.vn-char-player')?.value || null;
    // Uniqueness: one player → one char only
    if (c.playerId) {
      this._chars.forEach((other, i) => {
        if (i !== idx && other.playerId === c.playerId) other.playerId = null;
      });
    }
    c.locked = row.querySelector('.vn-char-locked')?.checked ?? false;
    if (c.model3d) c.model3d.locked = c.locked;
    // В режиме глубины scale пересчитывается из baseScale + Y; иначе scale = baseScale
    if (_state.depthMode) {
      c.scale  = parseFloat((c.baseScale * DDVNOverlay._perspectiveFactor(DDVNOverlay._depthY('char', c))).toFixed(3));
      c.zIndex = DDVNOverlay._depthZ('char', c);
    } else {
      c.scale = c.baseScale;
    }

    row.querySelectorAll('.vn-slider-val').forEach(v => {
      const inp = v.previousElementSibling;
      if (inp) v.textContent = inp.value;
    });

    DDVNManager.setChars(this._chars);
  }

  /** Apply an emotion to a character by name — only sets activeEmotion, never mutates img/activeImg */
  _applyEmotion(charId, emotionName) {
    const char = this._chars.find(c => c.id === charId);
    if (!char) return;
    char.activeEmotion = emotionName || '';
    // Execute per-emotion macro if set
    if (emotionName) {
      const emo = (char.emotions || []).find(e => e.name === emotionName);
      if (emo?.macroId) {
        const macro = game.macros?.get(emo.macroId) ?? game.macros?.getName(emo.macroId);
        if (macro) _execMacro(macro.id);
        else ui.notifications?.warn(`Drama Director: ${game.i18n.localize('DRAMADIRECTOR.notifications.emotionMacroNotFound')} (${emo.macroId})`);
      }
    }
    this._refreshPositionsFromState();
    DDVNManager.setChars(this._chars);
  }

  /** Синхронизирует позиции (x, y, scale, zIndex, _pinned) из _state в this._chars.
   *  Вызывается перед любым setChars(this._chars) чтобы не затереть результаты дрэга. */
  _refreshPositionsFromState() {
    const stateChars = DDVNManager.getState().chars;
    this._chars.forEach(c => {
      const sc = stateChars.find(s => s.id === c.id);
      if (!sc) return;
      c.x            = sc.x;
      c.y            = sc.y;
      c.zIndex       = sc.zIndex;
      c.scale        = sc.scale;
      c.baseScale    = sc.baseScale;
      c._pinned      = sc._pinned;
      c._pinnedWidth = sc._pinnedWidth;
    });
  }

  _recalcSlots() {
    let l = 0, c = 0, r = 0;
    this._chars.forEach(char => {
      if (char.side === 'left') char.slot = l++;
      else if (char.side === 'center') char.slot = c++;
      else char.slot = r++;
    });
  }

  _sortChars() {
    this._chars.sort((a, b) => {
      if (a.side !== b.side) {
        const order = { left: 0, center: 1, right: 2 };
        return order[a.side] - order[b.side];
      }
      return a.slot - b.slot;
    });
  }

  _openFilePicker(type, callback) {
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation;

    // Disable pointer-events on BOTH the VN overlay AND the VN panel window.
    // Without this, Foundry's bringToTop() gives the panel a z-index higher than
    // the FilePicker which then intercepts all mouse events.
    const overlay = document.getElementById('dd-vn-overlay');
    const panelEl = this.element;   // DDVNPanel ApplicationV2 window element

    let styleObs = null;
    let domObs   = null;

    const _restore = () => {
      if (overlay) overlay.classList.remove('vn-fp-open');
      if (panelEl) panelEl.style.removeProperty('pointer-events');
      if (styleObs) { styleObs.disconnect(); styleObs = null; }
      if (domObs)   { domObs.disconnect();   domObs   = null; }
    };

    // Freeze panel so Foundry focus management cannot bring it above the FilePicker
    if (overlay) overlay.classList.add('vn-fp-open');
    if (panelEl) panelEl.style.setProperty('pointer-events', 'none', 'important');

    const fp = new FilePickerClass({
      type: type,
      callback: (path) => {
        _restore();
        callback(path);
      },
    });

    fp.render({ force: true });

    // After render: pin FilePicker at a z-index no Foundry counter can beat,
    // and re-apply it whenever Foundry's bringToTop() tries to lower it.
    setTimeout(() => {
      // Resolve FilePicker DOM element — works for both V12 (jQuery) and V13
      let fpEl = fp.element;
      if (fpEl && typeof fpEl.jquery !== 'undefined') fpEl = fpEl[0];
      if (!fpEl || !document.contains(fpEl)) {
        fpEl = document.querySelector(
          '.filepicker, [data-application="file-picker"], [data-application="FilePicker"]'
        );
      }

      if (!fpEl) {
        // Last-resort fallback: restore after 60 s so UI is not permanently broken
        setTimeout(_restore, 60000);
        return;
      }

      const PIN_Z = '999999';
      const _pinZ = () => fpEl.style.setProperty('z-index', PIN_Z, 'important');
      _pinZ();

      // Watch the FilePicker element's style attribute — if Foundry's window
      // manager resets z-index (bringToTop), immediately re-pin it.
      styleObs = new MutationObserver(() => _pinZ());
      styleObs.observe(fpEl, { attributes: true, attributeFilter: ['style'] });

      // Watch the DOM tree for FilePicker removal (cancel / close button).
      // subtree:true catches removal regardless of nesting depth in #interface.
      domObs = new MutationObserver(() => {
        if (!document.contains(fpEl)) {
          _restore();
        }
      });
      domObs.observe(document.documentElement, { childList: true, subtree: true });
    }, 120);
  }

  /** Open a FilePicker in folder mode. If the selected folder has subfolders,
   *  each subfolder becomes a category (its files = variants).
   *  If no subfolders, the folder itself becomes a category. */
  _importBgFromFolder(el) {
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation;
    const overlay = document.getElementById('dd-vn-overlay');
    const panelEl = this.element;

    const _restore = () => {
      if (overlay) overlay.classList.remove('vn-fp-open');
      if (panelEl) panelEl.style.removeProperty('pointer-events');
    };

    if (overlay) overlay.classList.add('vn-fp-open');
    if (panelEl) panelEl.style.setProperty('pointer-events', 'none', 'important');

    const IMG_EXT = /\.(webp|png|jpg|jpeg|gif|svg|webm|mp4)$/i;

    const fp = new FilePickerClass({
      type: 'folder',
      callback: async (folderPath) => {
        _restore();
        if (!folderPath) return;

        let result;
        try {
          result = await FilePicker.browse('data', folderPath);
        } catch (e) {
          ui.notifications?.error('Drama Director: не удалось прочитать папку — ' + e.message);
          return;
        }

        const subFolders = result.dirs || [];
        const topFiles   = (result.files || []).filter(f => IMG_EXT.test(f));
        let added = 0;

        if (subFolders.length > 0) {
          // Each subfolder → one category
          for (const subDir of subFolders) {
            let subResult;
            try { subResult = await FilePicker.browse('data', subDir); } catch { continue; }
            const files = (subResult.files || []).filter(f => IMG_EXT.test(f));
            if (!files.length) continue;

            const categoryName = decodeURIComponent(subDir.split('/').filter(Boolean).pop());
            const variants = files.map(f => ({
              name: decodeURIComponent(f.split('/').pop().replace(/\.[^/.]+$/, '')),
              src:  f,
            }));
            await DDVNPresets.saveBg(`bg-${Date.now()}-${added}`, { name: categoryName, variants });
            added++;
          }
          // Also add top-level files as their own category if any
          if (topFiles.length) {
            const rootName = decodeURIComponent(folderPath.split('/').filter(Boolean).pop());
            const variants = topFiles.map(f => ({
              name: decodeURIComponent(f.split('/').pop().replace(/\.[^/.]+$/, '')),
              src:  f,
            }));
            await DDVNPresets.saveBg(`bg-${Date.now()}-root`, { name: rootName, variants });
            added++;
          }
        } else {
          // No subfolders — use folder itself as single category
          if (!topFiles.length) {
            ui.notifications?.warn('Drama Director: в папке не найдено изображений');
            return;
          }
          const categoryName = decodeURIComponent(folderPath.split('/').filter(Boolean).pop());
          const variants = topFiles.map(f => ({
            name: decodeURIComponent(f.split('/').pop().replace(/\.[^/.]+$/, '')),
            src:  f,
          }));
          await DDVNPresets.saveBg(`bg-${Date.now()}`, { name: categoryName, variants });
          added = 1;
        }

        if (added) {
          ui.notifications?.info(`Drama Director: добавлено категорий: ${added}`);
          this.render();
        } else {
          ui.notifications?.warn('Drama Director: в выбранной папке не найдено изображений');
        }
      },
    });

    fp.render({ force: true });

    setTimeout(() => {
      let fpEl = fp.element;
      if (fpEl && typeof fpEl.jquery !== 'undefined') fpEl = fpEl[0];
      if (!fpEl || !document.contains(fpEl))
        fpEl = document.querySelector('.filepicker, [data-application="file-picker"], [data-application="FilePicker"]');
      if (fpEl) {
        const PIN_Z = '999999';
        fpEl.style.setProperty('z-index', PIN_Z, 'important');
        const obs = new MutationObserver(() => fpEl.style.setProperty('z-index', PIN_Z, 'important'));
        obs.observe(fpEl, { attributes: true, attributeFilter: ['style'] });
        const domObs = new MutationObserver(() => {
          if (!document.contains(fpEl)) { obs.disconnect(); domObs.disconnect(); _restore(); }
        });
        domObs.observe(document.body, { childList: true, subtree: true });
      }
    }, 150);
  }

  _showBgEditForm(el, editId = null) {
    document.body.querySelector('.vn-bg-edit-overlay')?.remove();

    const editBg = editId ? DDVNPresets.listBg().find(b => b.id === editId) : null;

    const form = document.createElement('div');
    form.id = 'vn-bg-edit-form';
    form.className = 'vn-bg-edit-form';
    form.innerHTML = `
      <h4>${editBg ? game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.titleEdit') : game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.titleAdd')}</h4>
      <div class="dd-row">
        <label>${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.name')}</label>
        <input type="text" id="vn-bg-edit-name" class="dd-input" value="${editBg?.name || ''}" placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.name')}"/>
      </div>
      <div style="margin-top:6px">
        <label style="font-size:10px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.06em">Теги категории</label>
        <div class="vn-tag-input-wrap" id="vn-bg-edit-tags-wrap" style="margin-top:4px">
          <div class="vn-tag-chips-row" id="vn-bg-edit-tags-chips">
            ${(editBg?.tags || []).map(t => `<span class="vn-tag-chip">${t}<button class="vn-tag-chip-del" data-tag="${t}" tabindex="-1">×</button></span>`).join('')}
          </div>
          <input class="vn-tag-inp dd-input" id="vn-bg-edit-tag-inp" type="text" placeholder="тег + Enter" autocomplete="off" style="margin-top:4px"/>
        </div>
      </div>
      <div id="vn-bg-edit-variants" style="margin-top:8px">
        ${(editBg?.variants || [{name: '', src: ''}]).map((v, i) => `
          <div class="vn-bg-edit-variant" data-variant-idx="${i}">
            <div class="dd-row">
              <input type="text" class="vn-bg-edit-vname dd-input" value="${v.name || ''}" placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.variantName')}"/>
              <input type="text" class="vn-bg-edit-vpath dd-input" value="${v.src || ''}" placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.variantPath')}"/>
              <button type="button" class="dd-icon-btn vn-bg-edit-browse"><i class="fas fa-folder-open"></i></button>
              ${i > 0 ? '<button type="button" class="dd-icon-btn dd-danger-btn vn-bg-edit-vdel"><i class="fas fa-times"></i></button>' : ''}
            </div>
            <div class="vn-tag-input-wrap vn-bg-variant-tags" style="margin-top:3px">
              <div class="vn-tag-chips-row">${(v.tags || []).map(t => `<span class="vn-tag-chip">${t}<button class="vn-tag-chip-del" data-tag="${t}" tabindex="-1">×</button></span>`).join('')}</div>
              <input class="vn-tag-inp dd-input" type="text" placeholder="тег + Enter" autocomplete="off" style="font-size:10px;padding:2px 5px"/>
            </div>
          </div>
        `).join('')}
      </div>
      <button type="button" class="vn-btn-add" id="vn-bg-edit-add-variant"><i class="fas fa-plus"></i> ${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.addVariant')}</button>
      <div class="dd-row" style="margin-top:8px">
        <button type="button" class="vn-btn-secondary" data-action="vn-bg-edit-cancel" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#888;font-size:11px;padding:6px 12px;cursor:pointer;border-radius:5px;">${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.cancel')}</button>
        <button type="button" class="vn-btn-primary" data-action="vn-bg-edit-save" style="background:#f59e0b;border:none;color:#0e0e10;font-weight:700;font-size:11px;padding:7px 14px;cursor:pointer;border-radius:5px;letter-spacing:.03em;">${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.save')}</button>
      </div>
    `;

    // Attach to document.body with position:fixed so the overlay is never
    // clipped by overflow:hidden on .vn-panel-body or .window-content.
    const overlay = document.createElement('div');
    overlay.className = 'vn-bg-edit-overlay';
    overlay.appendChild(form);

    // Close on backdrop click (clicking outside the form box)
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.querySelector('.vn-bg-edit-overlay')?.remove();
    document.body.appendChild(overlay);

    // Force button styles via JS setProperty — same pattern used for the launch
    // button (line ~3106). This beats any Foundry stylesheet !important rule.
    requestAnimationFrame(() => {
      // Form box background
      form.style.setProperty('background', '#1a1a1e', 'important');
      form.style.setProperty('border', '1px solid rgba(255,255,255,.07)', 'important');
      form.style.setProperty('color', '#c8c8d0', 'important');

      const saveBtn = form.querySelector('[data-action="vn-bg-edit-save"]');
      if (saveBtn) {
        saveBtn.style.setProperty('background', '#f59e0b', 'important');
        saveBtn.style.setProperty('color', '#0e0e10', 'important');
        saveBtn.style.setProperty('border', 'none', 'important');
        saveBtn.style.setProperty('font-weight', '700', 'important');
        saveBtn.style.setProperty('font-size', '11px', 'important');
        saveBtn.style.setProperty('padding', '7px 14px', 'important');
        saveBtn.style.setProperty('border-radius', '5px', 'important');
        saveBtn.style.setProperty('cursor', 'pointer', 'important');
        saveBtn.style.setProperty('opacity', '1', 'important');
      }
      const cancelBtn = form.querySelector('[data-action="vn-bg-edit-cancel"]');
      if (cancelBtn) {
        cancelBtn.style.setProperty('background', 'rgba(255,255,255,.07)', 'important');
        cancelBtn.style.setProperty('color', '#aaa', 'important');
        cancelBtn.style.setProperty('border', '1px solid rgba(255,255,255,.15)', 'important');
        cancelBtn.style.setProperty('font-size', '11px', 'important');
        cancelBtn.style.setProperty('padding', '6px 12px', 'important');
        cancelBtn.style.setProperty('border-radius', '5px', 'important');
        cancelBtn.style.setProperty('cursor', 'pointer', 'important');
        cancelBtn.style.setProperty('opacity', '1', 'important');
      }
      form.querySelector('#vn-bg-edit-name')?.focus();
    });

    form.querySelector('#vn-bg-edit-add-variant')?.addEventListener('click', () => {
      const variantsContainer = form.querySelector('#vn-bg-edit-variants');
      const count = variantsContainer.querySelectorAll('.vn-bg-edit-variant').length;

      const newVariant = document.createElement('div');
      newVariant.className = 'vn-bg-edit-variant';
      newVariant.dataset.variantIdx = count;
      newVariant.innerHTML = `
        <div class="dd-row">
          <input type="text" class="vn-bg-edit-vname dd-input" value="" placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.variantName')}"/>
          <input type="text" class="vn-bg-edit-vpath dd-input" value="" placeholder="${game.i18n.localize('DRAMADIRECTOR.vn.bgEdit.variantPath')}"/>
          <button type="button" class="dd-icon-btn vn-bg-edit-browse"><i class="fas fa-folder-open"></i></button>
          <button type="button" class="dd-icon-btn dd-danger-btn vn-bg-edit-vdel"><i class="fas fa-times"></i></button>
        </div>
      `;
      variantsContainer.appendChild(newVariant);
      this._bindVariantEvents(newVariant);
    });

    form.querySelectorAll('.vn-bg-edit-variant').forEach(v => {
      this._bindVariantEvents(v);
      const tagWrap = v.querySelector('.vn-bg-variant-tags');
      if (tagWrap) {
        // Tags stored live in DOM chips; extracted on save
        const chipsRow = tagWrap.querySelector('.vn-tag-chips-row');
        const inp = tagWrap.querySelector('.vn-tag-inp');
        if (inp && chipsRow) {
          const refreshChips = () => {
            chipsRow.querySelectorAll('.vn-tag-chip-del').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                btn.closest('.vn-tag-chip')?.remove();
              });
            });
          };
          refreshChips();
          chipsRow.querySelectorAll('.vn-tag-chip-del').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); btn.closest('.vn-tag-chip')?.remove(); });
          });
          inp.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ',') return;
            e.preventDefault();
            const val = inp.value.trim().toLowerCase().replace(/[^a-zа-яё0-9_\-]/gi, '');
            if (!val) return;
            const chip = document.createElement('span');
            chip.className = 'vn-tag-chip';
            chip.innerHTML = `${val}<button class="vn-tag-chip-del" data-tag="${val}" tabindex="-1">×</button>`;
            chip.querySelector('.vn-tag-chip-del').addEventListener('click', (e) => { e.stopPropagation(); chip.remove(); });
            chipsRow.appendChild(chip);
            inp.value = '';
          });
        }
      }
    });

    // Tags binding
    this._bindTagInput(
      form.querySelector('#vn-bg-edit-tags-wrap'),
      () => {
        const chips = form.querySelectorAll('#vn-bg-edit-tags-chips .vn-tag-chip');
        return [...chips].map(c => c.childNodes[0].textContent.trim()).filter(Boolean);
      },
      (tags) => {
        const chips = form.querySelector('#vn-bg-edit-tags-chips');
        if (chips) chips.innerHTML = tags.map(t =>
          `<span class="vn-tag-chip">${t}<button class="vn-tag-chip-del" data-tag="${t}" tabindex="-1">×</button></span>`
        ).join('');
      }
    );

    const closeOverlay = () => (form.closest('.vn-bg-edit-overlay') || form).remove();

    form.querySelector('[data-action="vn-bg-edit-cancel"]')?.addEventListener('click', closeOverlay);
    form.querySelector('[data-action="vn-bg-edit-save"]')?.addEventListener('click', async () => {
      const name = form.querySelector('#vn-bg-edit-name')?.value?.trim();
      if (!name) {
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.notifications.bgNameRequired'));
        return;
      }

      const variants = [];
      form.querySelectorAll('.vn-bg-edit-variant').forEach(vRow => {
        const vName = vRow.querySelector('.vn-bg-edit-vname')?.value?.trim();
        const vPath = vRow.querySelector('.vn-bg-edit-vpath')?.value?.trim();
        if (!vPath) return;
        const tags = [...vRow.querySelectorAll('.vn-tag-chip')].map(c => c.textContent.replace('×','').trim()).filter(Boolean);
        variants.push({ name: vName || vPath.split('/').pop(), src: vPath, tags });
      });

      if (!variants.length) {
        ui.notifications?.warn(game.i18n.localize('DRAMADIRECTOR.notifications.bgVariantRequired'));
        return;
      }

      const bgId = editId || `bg-${Date.now()}`;
      // Collect tags from the tag chips
      const tags = [...form.querySelectorAll('#vn-bg-edit-tags-chips .vn-tag-chip')]
        .map(c => c.childNodes[0].textContent.trim()).filter(Boolean);
      await DDVNPresets.saveBg(bgId, { name, variants, tags });
      closeOverlay();
      this.render();
    });
  }

  _bindVariantEvents(vRow) {
    vRow.querySelector('.vn-bg-edit-browse')?.addEventListener('click', () => {
      this._openFilePicker('imagevideo', p => {
        const inp = vRow.querySelector('.vn-bg-edit-vpath');
        if (inp) {
          inp.value = p;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    vRow.querySelector('.vn-bg-edit-vdel')?.addEventListener('click', () => vRow.remove());
  }

  async _saveBgFromForm(el) {
    // This is handled in _showBgEditForm now
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNApi {
  static launchWithMapCharacters() { DDVNManager.launchWithMapCharacters(); }
  static setScene3D(config) {
    if (!game.user?.isGM) return;
    _state.scene3d = scene3D(config);
    DDVNManager.broadcast();
    DDVNPanel._instance?.render();
  }
  static setCharacter3D(id, config) {
    if (!game.user?.isGM) return;
    const char = _state.chars.find(c => c.id === id);
    if (!char) throw new Error(`Unknown character: ${id}`);
    char.model3d = model3D(config);
    char.locked = char.model3d.locked;
    const local = DDVNPanel._instance?._chars.find(c => c.id === id);
    if (local) { local.model3d = deepClone(char.model3d); local.locked = char.locked; }
    DDVNManager.broadcast();
    DDVNPanel._instance?.render();
  }
  static open() { DDVNManager.open(); }
  static openLocal() { DDVNManager.openLocal(); }
  static showToPlayers() { DDVNManager.showToPlayers(); }
  static stop() { DDVNManager.stop(true); }
  static setBackground(path) { DDVNManager.setBackground(path); }
  static setChars(chars) { DDVNManager.setChars(chars); }
  static setLayers(layers) { DDVNManager.setLayers(layers); }
  static setInteractiveImages(images) { DDVNManager.setInteractiveImages(images); }
  static showDialogue(name, text, color, autoClose) { DDVNManager.showDialogue(name, text, color, autoClose); }
  static hideDialogue() { DDVNManager.hideDialogue(); }
  static activateExclusive(id) { DDVNManager.activateExclusive(id); }
  static deactivateAll() { DDVNManager.deactivateAll(); }
  static openPanel() {
    if (!game.user?.isGM) return;
    if (DDVNPanel._instance) {
      DDVNPanel._instance.render({force: true});
    } else {
      new DDVNPanel().render({force: true});
    }
  }

  // ── Quick Save / Quick Load ─────────────────────────────────────────────
  static async quickSave() { return DDVNManager.quickSaveScene(); }

  static quickLoad() {
    const scene = DDVNPresets.getScene('QuickSave');
    if (!scene) {
      ui.notifications?.warn(game.i18n.format('DRAMADIRECTOR.notifications.sceneNotFound', { name: 'QuickSave' }));
      return;
    }
    DDVNManager.applySceneState(scene);
    DDVNOverlay.ensureOpen();
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.sceneLoaded', { name: 'QuickSave' }));
  }

  // ── Preset loaders ──────────────────────────────────────────────────────
  static loadScenePreset(name) {
    const scene = DDVNPresets.getScene(name);
    if (!scene) {
      ui.notifications?.warn(game.i18n.format('DRAMADIRECTOR.notifications.sceneNotFound', { name }));
      return;
    }
    DDVNManager.applySceneState(scene);
    DDVNOverlay.ensureOpen();
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.sceneLoaded', { name }));
  }

  static loadCharPreset(name) {
    const chars = DDVNPresets.getChars(name);
    if (!chars) {
      ui.notifications?.warn(game.i18n.format('DRAMADIRECTOR.notifications.rosterNotFound', { name }));
      return;
    }
    _state.chars = deepClone(chars);
    if (DDVNPanel._instance) {
      DDVNPanel._instance._chars = deepClone(_state.chars);
      DDVNPanel._instance.render();
    }
    DDVNManager.broadcast();
    DDVNOverlay.ensureOpen();
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.rosterLoaded', { name, count: chars.length }));
  }

  static loadLayerPreset(name) {
    const layers = DDVNPresets.getLayers(name);
    if (!layers) {
      ui.notifications?.warn(game.i18n.format('DRAMADIRECTOR.notifications.layerPresetNotFound', { name }));
      return;
    }
    _state.layers = layers.some(l => 'src' in l || 'text' in l) ? deepClone(layers) : DDVNPresets.applyTransformSnapshot(_state.layers, layers);
    if (DDVNPanel._instance) {
      DDVNPanel._instance._layers = deepClone(_state.layers);
      DDVNPanel._instance.render();
    }
    DDVNManager.broadcast();
    DDVNOverlay.ensureOpen();
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.layerPresetLoaded', { name, count: layers.length }));
  }

  static loadIimgPreset(name) {
    const iimgs = DDVNPresets.getIimgs(name);
    if (!iimgs) {
      ui.notifications?.warn(game.i18n.format('DRAMADIRECTOR.notifications.iimgPresetNotFound', { name }));
      return;
    }
    _state.interactiveImages = iimgs.some(i => 'src' in i) ? deepClone(iimgs) : DDVNPresets.applyTransformSnapshot(_state.interactiveImages, iimgs);
    if (DDVNPanel._instance) {
      DDVNPanel._instance._interactiveImages = deepClone(_state.interactiveImages);
      DDVNPanel._instance.render();
    }
    DDVNManager.broadcast();
    DDVNOverlay.ensureOpen();
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.iimgPresetLoaded', { name, count: iimgs.length }));
  }

  // ── Save presets from macro ─────────────────────────────────────────────
  static async saveScenePreset(name) {
    if (!name) return;
    await DDVNPresets.saveScene(name, DDVNPresets.makeSceneSnapshot(_state, true));
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.sceneSaved', { name }));
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static async saveCharPreset(name) {
    if (!name) return;
    await DDVNPresets.saveChars(name, deepClone(_state.chars));
    ui.notifications?.info(game.i18n.format('DRAMADIRECTOR.notifications.rosterSaved', { name }));
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static async saveLayerPreset(name) {
    if (!name) return;
    await DDVNPresets.saveLayers(name, deepClone(_state.layers));
    ui.notifications?.info(`Layer preset "${name}" saved.`);
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static async saveIimgPreset(name) {
    if (!name) return;
    await DDVNPresets.saveIimgs(name, deepClone(_state.interactiveImages));
    ui.notifications?.info(`Interactive preset "${name}" saved.`);
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  // ── Delete presets from macro ───────────────────────────────────────────
  static async deleteScenePreset(name) {
    if (!name) return;
    await DDVNPresets.deleteScene(name);
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static async deleteCharPreset(name) {
    if (!name) return;
    await DDVNPresets.deleteChars(name);
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static async deleteLayerPreset(name) {
    if (!name) return;
    await DDVNPresets.deleteLayers(name);
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  static async deleteIimgPreset(name) {
    if (!name) return;
    await DDVNPresets.deleteIimgs(name);
    if (DDVNPanel._instance) DDVNPanel._instance.render();
  }

  // ── List presets from macro ─────────────────────────────────────────────
  static listScenePresets() { return DDVNPresets.listScenes(); }
  static listCharPresets() { return DDVNPresets.listChars(); }
  static listLayerPresets() { return DDVNPresets.listLayers(); }
  static listIimgPresets() { return DDVNPresets.listIimgs(); }

  // ── Auto Save / Load ─────────────────────────────────────────────────────
  /** Manually trigger an autosave (same as what happens on stop) */
  static autoSave() { DDVNManager._autoSave(); }

  /** Restore the last saved session (AutoSave or QuickSave, whichever was last) */
  static autoLoad() {
    DDVNManager._autoLoadLastSave();
    DDVNOverlay.apply(_state);
    DDVNPanel._instance?.render();
  }

  // ── State access ────────────────────────────────────────────────────────
  static getState() { return deepClone(_state); }

  // ── Emotions ─────────────────────────────────────────────────────────────
  /**
   * Set an emotion on a character by char ID and emotion name.
   * @param {string} charId   - Character ID (from Characters tab)
   * @param {string} emoName  - Emotion name (must match exactly)
   */
  static setEmotion(charId, emoName) {
    DDVNEmotionManager.applyEmotion(charId, emoName || '');
  }

  /**
   * Reset the active emotion for a character (show base portrait).
   * @param {string} charId - Character ID
   */
  static resetEmotion(charId) {
    DDVNEmotionManager.applyEmotion(charId, '');
  }

  /**
   * List all emotion names defined for a character.
   * @param {string} charId - Character ID
   * @returns {string[]}
   */
  static listEmotions(charId) {
    const char = _state.chars.find(c => c.id === charId);
    return (char?.emotions ?? []).map(e => e.name).filter(Boolean);
  }

  /**
   * List all character IDs currently in the VN state.
   * @returns {{ id: string, name: string }[]}
   */
  static listChars() {
    return _state.chars.map(c => ({ id: c.id, name: c.name }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EMOTION MANAGER - Handles emotion selection panel, player menu, and wheel
// ─────────────────────────────────────────────────────────────────────────────
export class DDVNEmotionManager {
  // Emoji mapping for emotion names
  static EMOTION_EMOJI = {
    'normal':'😐','neutral':'😐','base':'😐','default':'🙂',
    'happy':'😄','smile':'🙂','joy':'😄','laugh':'😂',
    'sad':'😢','cry':'😭','sorrow':'😢','grief':'😥',
    'angry':'😡','anger':'😠','rage':'😤','mad':'😡',
    'fear':'😨','scared':'😱','horror':'😱','terror':'😨',
    'surprise':'😲','shocked':'😲','astonished':'😲',
    'disgust':'🤢','sick':'🤒','pain':'😣','hurt':'😣',
    'love':'😍','blush':'😊','embarrassed':'😳',
    'think':'🤔','confused':'😕','doubt':'🤨',
    'cool':'😎','smug':'😏','wink':'😉',
    'tired':'😴','sleepy':'😪','dead':'💀','knocked':'😵',
    'battle':'⚔️','fight':'🗡️','determined':'😤',
  };

  static FAVORITES_KEY = 'vnEmotionFavorites';

  // Get emoji for emotion name
  static getEmojiForName(name) {
    if (!name) return '🎭';
    const firstChar = [...name][0] ?? '';
    const cp = firstChar.codePointAt(0) ?? 0;
    if (cp > 0x1F300) return firstChar + ([...name][1] ?? ''); // emoji detected
    const key = name.toLowerCase().trim();
    for (const [k, emoji] of Object.entries(this.EMOTION_EMOJI)) {
      if (key.includes(k)) return emoji;
    }
    return '🎭';
  }

  static _favsCache = null; // in-memory cache — updated immediately on every write

  // ── Favorites System ─────────────────────────────────────────────────────
  static getFavorites() {
    if (this._favsCache !== null) return [...this._favsCache];
    const raw = game.user?.getFlag?.(MODULE_ID, this.FAVORITES_KEY);
    this._favsCache = Array.isArray(raw) ? [...raw] : [];
    return [...this._favsCache];
  }

  static async setFavorites(favs) {
    this._favsCache = [...favs]; // update cache before async write so next read is instant
    await game.user?.setFlag?.(MODULE_ID, this.FAVORITES_KEY, favs);
  }

  static async addFavorite(charId, emotionName) {
    const favs = this.getFavorites();
    const key = `${charId}:${emotionName}`;
    if (!favs.includes(key)) {
      favs.push(key);
      await this.setFavorites(favs);
    }
    this._onFavoritesChanged(charId);
  }

  static async removeFavorite(charId, emotionName) {
    const favs = this.getFavorites();
    const key = `${charId}:${emotionName}`;
    const idx = favs.indexOf(key);
    if (idx >= 0) {
      favs.splice(idx, 1);
      await this.setFavorites(favs);
    }
    this._onFavoritesChanged(charId);
  }

  /** Called after any favorites change — live-refreshes wheel and player menu */
  static _onFavoritesChanged(charId) {
    // Refresh wheel if open and belongs to this char
    if (this._wheelOpen) {
      const char = this._getPlayerChar() ?? _state.chars.find(c => c.id === charId);
      if (char) {
        const newFavs = this.getFavoritesForChar(char.id);
        this._wheelFavs = newFavs;
        this._wheelCurrentHover = -1; // reset - sector count/order may have changed
        if (newFavs.length === 0) {
          this.hideWheel();
        } else {
          // Re-render wheel in place (preserves position)
          this._renderWheel(char, newFavs);
          // Re-bind events with updated favs snapshot
          document.removeEventListener('mousemove', this._wheelMouseMoveHandler);
          document.removeEventListener('mousedown', this._wheelClickHandler, true);
          document.removeEventListener('wheel', this._wheelScrollHandler);
          this._bindWheelEvents(char, newFavs);
        }
      }
    }
    // Refresh player menu if open
    if (this._playerMenuOpen) {
      this._renderPlayerMenu();
    }
  }

  static isFavorite(charId, emotionName) {
    const favs = this.getFavorites();
    return favs.includes(`${charId}:${emotionName}`);
  }

  static getFavoritesForChar(charId) {
    const favs = this.getFavorites();
    const char = _state.chars.find(c => c.id === charId);
    const validNames = new Set((char?.emotions ?? []).map(e => e.name).filter(Boolean));
    return favs
      .filter(f => f.startsWith(`${charId}:`))
      .map(f => f.split(':')[1])
      .filter(name => validNames.has(name));
  }

  // ── Emotion Panel for GM (shows on right side of GM left bar) ────────────
  static _activeCharId = null;
  static _searchQuery = '';

  static showEmotionPanel(charId) {
    this._activeCharId = charId;
    this._searchQuery = '';
    this._renderPanel();
    this._renderPlayerMenu(); // Also update player menu if player owns this char
  }

  static hideEmotionPanel() {
    this._activeCharId = null;
    const panel = document.getElementById('vn-emotion-panel');
    if (panel) panel.remove();
  }

  static toggleEmotionPanel(charId) {
    if (this._activeCharId === charId) {
      this.hideEmotionPanel();
    } else {
      this.showEmotionPanel(charId);
    }
  }

  static _renderPanel() {
    if (!this._activeCharId) return;

    const char = _state.chars.find(c => c.id === this._activeCharId);
    if (!char) return;

    let panel = document.getElementById('vn-emotion-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'vn-emotion-panel';
      panel.className = 'vn-emotion-panel';
      document.getElementById('dd-vn-overlay')?.appendChild(panel);
    }

    const emotions = (char.emotions ?? []).filter(e => e.name?.trim());
    const q = this._searchQuery.toLowerCase().trim();
    const filtered = q ? emotions.filter(e => e.name.toLowerCase().includes(q)) : emotions;

    const loc = k => game.i18n.localize(k);

    panel.innerHTML = `
      <div class="vn-ep-header">
        <span class="vn-ep-title"><i class="fas fa-theater-masks"></i> ${char.name || loc('DRAMADIRECTOR.vn.gml.noName')}</span>
        <button class="vn-ep-close" id="vn-ep-close"><i class="fas fa-times"></i></button>
      </div>
      <div class="vn-ep-search">
        <input type="text" class="vn-ep-search-inp" placeholder="${loc('DRAMADIRECTOR.vn.gml.search')}" value="${this._searchQuery}"/>
      </div>
      <div class="vn-ep-list">
        <div class="vn-ep-item ${!char.activeEmotion ? 'vn-ep-active' : ''}" data-emo-name="">
          <div class="vn-ep-preview">
            ${char.img ? `<img src="${char.img}" alt="default"/>` : '<i class="fas fa-user"></i>'}
          </div>
          <span class="vn-ep-name">${loc('DRAMADIRECTOR.vn.emotionReset') || 'Сбросить'}</span>
        </div>
        ${filtered.map(e => {
          const emoji = e.emoji?.trim() || this.getEmojiForName(e.name);
          const isActive = char.activeEmotion === e.name;
          const isFav = this.isFavorite(char.id, e.name);
          return `
            <div class="vn-ep-item ${isActive ? 'vn-ep-active' : ''}" data-emo-name="${e.name}">
              <div class="vn-ep-preview">
                ${e.img ? `<img src="${e.img}" alt="${e.name}"/>` : `<span class="vn-ep-emoji">${emoji}</span>`}
              </div>
              <span class="vn-ep-name">${emoji} ${e.name}</span>
              <button class="vn-ep-fav ${isFav ? 'vn-ep-fav-active' : ''}" data-emo-name="${e.name}" title="${loc('DRAMADIRECTOR.vn.emotionFavorite') || 'В избранное'}">
                <i class="fas fa-star"></i>
              </button>
            </div>`;
        }).join('')}
        ${filtered.length === 0 ? `<div class="vn-ep-empty">${loc('DRAMADIRECTOR.notifications.nothingFound') || 'Ничего не найдено'}</div>` : ''}
      </div>
    `;

    panel.style.display = 'flex';

    // Bind events
    panel.querySelector('#vn-ep-close')?.addEventListener('click', () => this.hideEmotionPanel());
    panel.querySelector('.vn-ep-search-inp')?.addEventListener('input', (e) => {
      this._searchQuery = e.target.value;
      this._renderPanel();
    });

    panel.querySelectorAll('.vn-ep-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.vn-ep-fav')) return;
        const emoName = item.dataset.emoName ?? '';
        this.applyEmotion(this._activeCharId, emoName);
        this._renderPanel();
        this._renderPlayerMenu();
      });
    });

    panel.querySelectorAll('.vn-ep-fav').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoName = btn.dataset.emoName;
        if (this.isFavorite(this._activeCharId, emoName)) {
          await this.removeFavorite(this._activeCharId, emoName);
        } else {
          await this.addFavorite(this._activeCharId, emoName);
        }
        this._renderPanel(); // refresh star state in panel
        // _renderPlayerMenu + wheel refresh handled by _onFavoritesChanged
      });
    });
  }

  // ── Player Emotion Menu (right side dropdown) ─────────────────────────────
  static _playerMenuOpen = false;
  static _playerSearchQuery = '';

  static _getPlayerChar() {
    if (game.user?.isGM) {
      // GM uses selected char from GM bar
      return _state.chars.find(c => c.id === DDVNGMBar._gmCharId);
    }
    return _state.chars.find(c => c.playerId === game.userId);
  }

  static togglePlayerMenu() {
    this._playerMenuOpen = !this._playerMenuOpen;
    this._playerSearchQuery = '';
    this._renderPlayerMenu();
  }

  static _renderPlayerMenu() {
    const char = this._getPlayerChar();

    let menu = document.getElementById('vn-player-emotion-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'vn-player-emotion-menu';
      menu.className = 'vn-player-emotion-menu';
      document.getElementById('dd-vn-overlay')?.appendChild(menu);
    }

    if (!this._playerMenuOpen || !char) {
      menu.style.display = 'none';
      return;
    }

    const emotions = (char.emotions ?? []).filter(e => e.name?.trim());
    const q = this._playerSearchQuery.toLowerCase().trim();
    const filtered = q ? emotions.filter(e => e.name.toLowerCase().includes(q)) : emotions;
    const loc = k => game.i18n.localize(k);

    menu.innerHTML = `
      <div class="vn-pem-header">
        <span class="vn-pem-title"><i class="fas fa-theater-masks"></i> ${loc('DRAMADIRECTOR.vn.emotions') || 'Эмоции'}</span>
        <button class="vn-pem-close" id="vn-pem-close"><i class="fas fa-times"></i></button>
      </div>
      <div class="vn-pem-search">
        <input type="text" class="vn-pem-search-inp" placeholder="${loc('DRAMADIRECTOR.vn.gml.search')}" value="${this._playerSearchQuery}"/>
      </div>
      <div class="vn-pem-fav-section">
        <span class="vn-pem-section-title"><i class="fas fa-star"></i> ${loc('DRAMADIRECTOR.vn.emotionFavorites') || 'Избранное'}</span>
        <div class="vn-pem-fav-list">
          ${this._renderFavoritesList(char)}
        </div>
      </div>
      <div class="vn-pem-list">
        <div class="vn-pem-item ${!char.activeEmotion ? 'vn-pem-active' : ''}" data-emo-name="">
          <div class="vn-pem-preview">
            ${char.img ? `<img src="${char.img}" alt="default"/>` : '<i class="fas fa-user"></i>'}
          </div>
          <span class="vn-pem-name">${loc('DRAMADIRECTOR.vn.emotionReset') || 'Сбросить'}</span>
        </div>
        ${filtered.map(e => {
          const emoji = e.emoji?.trim() || this.getEmojiForName(e.name);
          const isActive = char.activeEmotion === e.name;
          const isFav = this.isFavorite(char.id, e.name);
          return `
            <div class="vn-pem-item ${isActive ? 'vn-pem-active' : ''}" data-emo-name="${e.name}">
              <div class="vn-pem-preview">
                ${e.img ? `<img src="${e.img}" alt="${e.name}"/>` : `<span class="vn-pem-emoji">${emoji}</span>`}
              </div>
              <span class="vn-pem-name">${emoji} ${e.name}</span>
              <button class="vn-pem-fav ${isFav ? 'vn-pem-fav-active' : ''}" data-emo-name="${e.name}" title="${loc('DRAMADIRECTOR.vn.emotionFavorite') || 'В избранное'}">
                <i class="fas fa-star"></i>
              </button>
            </div>`;
        }).join('')}
        ${filtered.length === 0 ? `<div class="vn-pem-empty">${loc('DRAMADIRECTOR.notifications.nothingFound') || 'Ничего не найдено'}</div>` : ''}
      </div>
    `;

    menu.style.display = 'flex';

    // Bind events
    menu.querySelector('#vn-pem-close')?.addEventListener('click', () => {
      this._playerMenuOpen = false;
      this._renderPlayerMenu();
    });
    menu.querySelector('.vn-pem-search-inp')?.addEventListener('input', (e) => {
      this._playerSearchQuery = e.target.value;
      this._renderPlayerMenu();
    });

    menu.querySelectorAll('.vn-pem-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.vn-pem-fav')) return;
        const emoName = item.dataset.emoName ?? '';
        this.applyEmotion(char.id, emoName);
        this._renderPlayerMenu();
        if (DDVNEmotionManager._activeCharId === char.id) {
          this._renderPanel();
        }
      });
    });

    menu.querySelectorAll('.vn-pem-fav').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const emoName = btn.dataset.emoName;
        if (this.isFavorite(char.id, emoName)) {
          await this.removeFavorite(char.id, emoName);
        } else {
          await this.addFavorite(char.id, emoName);
        }
        // _renderPlayerMenu + wheel refresh handled by _onFavoritesChanged
        if (DDVNEmotionManager._activeCharId === char.id) {
          this._renderPanel();
        }
      });
    });
  }

  static _renderFavoritesList(char) {
    const favEmotions = this.getFavoritesForChar(char.id);
    if (favEmotions.length === 0) {
      return `<span class="vn-pem-fav-empty">${game.i18n.localize('DRAMADIRECTOR.vn.emotionNoFavorites') || 'Нет избранных'}</span>`;
    }
    return favEmotions.map(emoName => {
      const e = (char.emotions ?? []).find(em => em.name === emoName);
      if (!e) return '';
      const isActive = char.activeEmotion === e.name;
      const preview = e.img
        ? `<img src="${e.img}" alt="${e.name}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;display:block;"/>`
        : `<div class="vn-pem-fav-text" title="${e.name}">${e.name.slice(0,3)}</div>`;
      return `
        <div class="vn-pem-fav-item${isActive ? ' vn-pem-active' : ''}" data-emo-name="${e.name}" title="${e.name}">
          ${preview}
        </div>`;
    }).join('');
  }

  // ── Apply Emotion ────────────────────────────────────────────────────────
  static applyEmotion(charId, emotionName) {
    const char = _state.chars.find(c => c.id === charId);
    if (!char) return;
    char.activeEmotion = emotionName || '';
    // Execute per-emotion macro if set
    if (emotionName) {
      const emo = (char.emotions || []).find(e => e.name === emotionName);
      if (emo?.macroId) {
        const macro = game.macros?.get(emo.macroId) ?? game.macros?.getName(emo.macroId);
        if (macro) _execMacro(macro.id);
        else ui.notifications?.warn(`Drama Director: ${game.i18n.localize('DRAMADIRECTOR.notifications.emotionMacroNotFound')} (${emo.macroId})`);
      }
    }
    DDVNManager.setChars(_state.chars);
  }

  // ── Emotion Wheel (middle mouse button) - Ring Style ───────────────────────
  static _wheelOpen = false;
  static _wheelX = 0;
  static _wheelY = 0;
  static _wheelCurrentHover = -1;
  static _wheelFavs = [];
  static _wheelSize = parseFloat(localStorage.getItem('dd-wheel-size') ?? '1');
  static _wheelTextMode = localStorage.getItem('dd-wheel-text') === '1';

  // Distinct dark-theme colours for each sector (cycles if more than 12)
  static SECTOR_COLORS = [
    '#1e3a5f', '#2a1f5c', '#1f3d2a', '#3d2a1f',
    '#3d1f2a', '#1f3a3d', '#3a3d1f', '#2a1f3d',
    '#1a4a6b', '#3b1a4a', '#1a4a2e', '#4a3b1a',
  ];
  static SECTOR_HOVER  = 'rgba(56,189,248,0.72)';
  static SECTOR_ACTIVE = '#145c30';

  static showWheel(x, y) {
    const char = this._getPlayerChar();
    if (!char) return;

    const favs = this.getFavoritesForChar(char.id);
    if (favs.length === 0) return;

    this._wheelOpen = true;
    this._wheelCurrentHover = -1;
    this._wheelFavs = favs;
    this._wheelX = x;
    this._wheelY = y;
    this._renderWheel(char, favs);
    this._bindWheelEvents(char, favs);
  }

  static hideWheel() {
    this._wheelOpen = false;
    this._wheelCurrentHover = -1;
    this._wheelFavs = [];
    const wheel = document.getElementById('vn-emotion-wheel');
    if (wheel) wheel.remove();
    document.removeEventListener('mousemove', this._wheelMouseMoveHandler);
    document.removeEventListener('mousedown', this._wheelClickHandler, true);
    document.removeEventListener('wheel', this._wheelScrollHandler);
  }

  static _renderWheel(char, favs) {
    let wheel = document.getElementById('vn-emotion-wheel');
    if (!wheel) {
      wheel = document.createElement('div');
      wheel.id = 'vn-emotion-wheel';
      wheel.className = 'vn-emotion-wheel';
      document.getElementById('dd-vn-overlay')?.appendChild(wheel);
    }

    // Apply current size scale
    const sz = Math.max(0.4, Math.min(2.5, this._wheelSize));
    wheel.style.width  = (300 * sz) + 'px';
    wheel.style.height = (300 * sz) + 'px';

    const forceText = this._wheelTextMode;

    const count  = favs.length;
    const step   = 360 / count;
    const CX = 150, CY = 150, INNER_R = 50, OUTER_R = 144;
    const GAP_DEG = count > 1 ? 2 : 0; // visual gap between sectors in degrees
    const LABEL_R = Math.round((INNER_R + OUTER_R) / 2); // label sits in ring centre

    // ── SVG donut-sector path helper (angles: 0 = north, clockwise) ──────
    const toRad = deg => (deg - 90) * Math.PI / 180;
    const sectorPath = (startDeg, endDeg) => {
      const spanDeg = endDeg - startDeg - GAP_DEG;
      // Full circle (single sector, 360°): SVG arc can't end at same point it starts,
      // so we draw two 180° half-arcs joined together.
      if (spanDeg >= 359.9) {
        const cos = Math.cos, sin = Math.sin;
        const top    = toRad(0);   // north
        const bottom = toRad(180); // south
        return [
          // Outer ring: top → bottom → top (two half-arcs)
          `M ${(CX + OUTER_R * cos(top)).toFixed(2)} ${(CY + OUTER_R * sin(top)).toFixed(2)}`,
          `A ${OUTER_R} ${OUTER_R} 0 0 1 ${(CX + OUTER_R * cos(bottom)).toFixed(2)} ${(CY + OUTER_R * sin(bottom)).toFixed(2)}`,
          `A ${OUTER_R} ${OUTER_R} 0 0 1 ${(CX + OUTER_R * cos(top)).toFixed(2)} ${(CY + OUTER_R * sin(top)).toFixed(2)}`,
          // Inner ring cutout: top → bottom → top (CCW)
          `M ${(CX + INNER_R * cos(top)).toFixed(2)} ${(CY + INNER_R * sin(top)).toFixed(2)}`,
          `A ${INNER_R} ${INNER_R} 0 0 0 ${(CX + INNER_R * cos(bottom)).toFixed(2)} ${(CY + INNER_R * sin(bottom)).toFixed(2)}`,
          `A ${INNER_R} ${INNER_R} 0 0 0 ${(CX + INNER_R * cos(top)).toFixed(2)} ${(CY + INNER_R * sin(top)).toFixed(2)}`,
          'Z',
        ].join(' ');
      }
      const s = toRad(startDeg + GAP_DEG / 2);
      const e = toRad(endDeg   - GAP_DEG / 2);
      const large = spanDeg > 180 ? 1 : 0;
      const cos = Math.cos, sin = Math.sin;
      return [
        `M ${(CX + INNER_R * cos(s)).toFixed(2)} ${(CY + INNER_R * sin(s)).toFixed(2)}`,
        `L ${(CX + OUTER_R * cos(s)).toFixed(2)} ${(CY + OUTER_R * sin(s)).toFixed(2)}`,
        `A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${(CX + OUTER_R * cos(e)).toFixed(2)} ${(CY + OUTER_R * sin(e)).toFixed(2)}`,
        `L ${(CX + INNER_R * cos(e)).toFixed(2)} ${(CY + INNER_R * sin(e)).toFixed(2)}`,
        `A ${INNER_R} ${INNER_R} 0 ${large} 0 ${(CX + INNER_R * cos(s)).toFixed(2)} ${(CY + INNER_R * sin(s)).toFixed(2)}`,
        'Z',
      ].join(' ');
    };

    // ── Build SVG layers: defs (clipPaths) · bg paths · images · name labels · hover overlay ──
    let defs        = '';
    let bgPaths     = '';   // solid colour fallback under every sector
    let imgLayer    = '';   // <image> clipped to sector (only for sectors with img)
    let nameLayer   = '';   // name-only label for sectors WITHOUT img
    let hoverLayer  = '';   // transparent hit-test + hover-highlight paths (top layer)

    // Ring height in px: OUTER_R - INNER_R = 94. Image box fits inside that.
    const IMG_SIZE = 82; // px — portrait fits fully, bg color shows around edges

    for (let i = 0; i < count; i++) {
      const start   = i * step;
      const end     = (i + 1) * step;
      const emoName = favs[i];
      const e       = (char.emotions ?? []).find(em => em.name === emoName);
      const isAct   = char.activeEmotion === emoName;
      const d       = sectorPath(start, end);
      const bgFill  = isAct ? this.SECTOR_ACTIVE : this.SECTOR_COLORS[i % this.SECTOR_COLORS.length];

      // Sector midpoint position (for image/label centering)
      const midAngle = (start + step / 2 - 90) * Math.PI / 180;
      const lx = (CX + LABEL_R * Math.cos(midAngle)).toFixed(2);
      const ly = (CY + LABEL_R * Math.sin(midAngle)).toFixed(2);

      // 1. Background colour — always full opacity, image overlays on top
      bgPaths += `<path d="${d}" fill="${bgFill}"/>`;

      if (e?.img && !forceText) {
        // 2a. clipPath so image stays within sector bounds
        defs += `<clipPath id="vn-ew-clip-${i}"><path d="${d}"/></clipPath>`;

        const ix = (lx - IMG_SIZE / 2).toFixed(2);
        const iy = (ly - IMG_SIZE / 2).toFixed(2);

        // 2b. Fixed-size image centred in sector, "meet" = show full portrait, no aggressive crop
        //     A dark semi-transparent rect underneath so bg colour shows softly behind it
        imgLayer += `
          <rect x="${ix}" y="${iy}" width="${IMG_SIZE}" height="${IMG_SIZE}"
            fill="rgba(0,0,0,0.25)" clip-path="url(#vn-ew-clip-${i})" rx="4"/>
          <image href="${e.img}"
            x="${ix}" y="${iy}" width="${IMG_SIZE}" height="${IMG_SIZE}"
            clip-path="url(#vn-ew-clip-${i})"
            preserveAspectRatio="xMidYMid meet"
            style="image-rendering:auto"/>`;

        // Active glow border inside sector
        if (isAct) {
          imgLayer += `<path d="${d}" fill="none" stroke="#4ade80" stroke-width="3" opacity="0.85"/>`;
        }
      } else {
        // 2c. Name-only label — when no image, OR when text mode is forced
        if (e || forceText) {
          const label = emoName || '?';
          const shortName = label.length > 12 ? label.slice(0, 11) + '…' : label;
          const fontSize = shortName.length > 8 ? 10 : shortName.length > 5 ? 12 : 14;
          const foW = 88, foH = 40;
          nameLayer += `
            <foreignObject x="${(lx - foW/2).toFixed(1)}" y="${(ly - foH/2).toFixed(1)}"
                           width="${foW}" height="${foH}" style="overflow:visible">
              <div xmlns="http://www.w3.org/1999/xhtml"
                   class="vn-ew-fo-label${isAct ? ' vn-ew-fo-active' : ''}"
                   style="font-size:${fontSize}px">
                <span class="vn-ew-fo-name">${shortName}</span>
              </div>
            </foreignObject>`;
        }
      }

      // 3. Top transparent hover/click path
      hoverLayer += `<path class="vn-ew-sector" data-idx="${i}"
        d="${d}" fill="transparent"
        stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`;
    }

    wheel.innerHTML = `
      <svg class="vn-ew-svg" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="vn-ew-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#000" flood-opacity="0.8"/>
          </filter>
          ${defs}
        </defs>
        <g filter="url(#vn-ew-shadow)">
          ${bgPaths}
        </g>
        ${imgLayer}
        ${nameLayer}
        <circle cx="${CX}" cy="${CY}" r="${OUTER_R + 1}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"/>
        <circle cx="${CX}" cy="${CY}" r="${INNER_R}" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
        <g id="vn-ew-hover-overlay"></g>
        ${hoverLayer}
      </svg>
      <div class="vn-ew-center" title="Сбросить эмоцию">
        <i class="fas fa-undo"></i>
        <span class="vn-ew-center-text">Сброс</span>
      </div>
      <div class="vn-ew-controls">
        <button class="vn-ew-ctrl-btn" id="vn-ew-size-down" title="Уменьшить колесо">−</button>
        <button class="vn-ew-ctrl-btn vn-ew-ctrl-mode${forceText ? ' active' : ''}" id="vn-ew-mode-toggle" title="${forceText ? 'Показывать картинки' : 'Показывать текст'}">
          <i class="fas fa-${forceText ? 'image' : 'font'}"></i>
        </button>
        <button class="vn-ew-ctrl-btn" id="vn-ew-size-up" title="Увеличить колесо">+</button>
      </div>
    `;

    wheel.style.left = this._wheelX + 'px';
    wheel.style.top  = this._wheelY + 'px';
    wheel.style.display = 'block';
  }

  /** Update sector fill colours to reflect hover / active state */
  static _highlightWheelSector(hoverIdx, char, favs) {
    const wheel = document.getElementById('vn-emotion-wheel');
    if (!wheel) return;

    const overlay = wheel.querySelector('#vn-ew-hover-overlay');
    if (!overlay) return;

    if (hoverIdx < 0) {
      overlay.innerHTML = '';
      return;
    }

    const count = favs.length;
    const step  = 360 / count;
    const CX = 150, CY = 150, INNER_R = 50, OUTER_R = 144;
    const GAP_DEG = count > 1 ? 2 : 0;
    const toRad = deg => (deg - 90) * Math.PI / 180;

    const sectorPath = (startDeg, endDeg) => {
      const spanDeg = endDeg - startDeg - GAP_DEG;
      if (spanDeg >= 359.9) {
        const cos = Math.cos, sin = Math.sin;
        const top = toRad(0), bottom = toRad(180);
        return [
          `M ${(CX + OUTER_R * cos(top)).toFixed(2)} ${(CY + OUTER_R * sin(top)).toFixed(2)}`,
          `A ${OUTER_R} ${OUTER_R} 0 0 1 ${(CX + OUTER_R * cos(bottom)).toFixed(2)} ${(CY + OUTER_R * sin(bottom)).toFixed(2)}`,
          `A ${OUTER_R} ${OUTER_R} 0 0 1 ${(CX + OUTER_R * cos(top)).toFixed(2)} ${(CY + OUTER_R * sin(top)).toFixed(2)}`,
          `M ${(CX + INNER_R * cos(top)).toFixed(2)} ${(CY + INNER_R * sin(top)).toFixed(2)}`,
          `A ${INNER_R} ${INNER_R} 0 0 0 ${(CX + INNER_R * cos(bottom)).toFixed(2)} ${(CY + INNER_R * sin(bottom)).toFixed(2)}`,
          `A ${INNER_R} ${INNER_R} 0 0 0 ${(CX + INNER_R * cos(top)).toFixed(2)} ${(CY + INNER_R * sin(top)).toFixed(2)}`,
          'Z',
        ].join(' ');
      }
      const s = toRad(startDeg + GAP_DEG / 2);
      const e = toRad(endDeg   - GAP_DEG / 2);
      const large = spanDeg > 180 ? 1 : 0;
      const cos = Math.cos, sin = Math.sin;
      return [
        `M ${(CX + INNER_R * cos(s)).toFixed(2)} ${(CY + INNER_R * sin(s)).toFixed(2)}`,
        `L ${(CX + OUTER_R * cos(s)).toFixed(2)} ${(CY + OUTER_R * sin(s)).toFixed(2)}`,
        `A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${(CX + OUTER_R * cos(e)).toFixed(2)} ${(CY + OUTER_R * sin(e)).toFixed(2)}`,
        `L ${(CX + INNER_R * cos(e)).toFixed(2)} ${(CY + INNER_R * sin(e)).toFixed(2)}`,
        `A ${INNER_R} ${INNER_R} 0 ${large} 0 ${(CX + INNER_R * cos(s)).toFixed(2)} ${(CY + INNER_R * sin(s)).toFixed(2)}`,
        'Z',
      ].join(' ');
    };

    const start = hoverIdx * step;
    const end   = (hoverIdx + 1) * step;
    overlay.innerHTML = `<path d="${sectorPath(start, end)}" fill="rgba(56,189,248,0.38)" stroke="rgba(56,189,248,0.7)" stroke-width="2"/>`;
  }

  static _bindWheelEvents(char, favs) {
    const step = 360 / favs.length;

    // Mouse move handler for highlighting
    this._wheelMouseMoveHandler = (e) => {
      if (!this._wheelOpen) return;
      
      const idx = this._getAngleIndex(e.clientX, e.clientY);
      
      if (idx !== this._wheelCurrentHover) {
        this._wheelCurrentHover = idx;
        this._highlightWheelSector(idx, char, favs);
      }
    };

    // Click handler for selection or closing
    this._wheelClickHandler = (e) => {
      if (!this._wheelOpen) return;
      
      // If clicking on center, reset emotion
      if (e.target.closest('.vn-ew-center')) {
        this.applyEmotion(char.id, '');
        this.hideWheel();
        return;
      }

      // Size down button
      if (e.target.closest('#vn-ew-size-down')) {
        e.stopPropagation();
        this._wheelSize = parseFloat(Math.max(0.4, this._wheelSize - 0.15).toFixed(2));
        localStorage.setItem('dd-wheel-size', this._wheelSize);
        this._renderWheel(char, favs);
        return;
      }

      // Size up button
      if (e.target.closest('#vn-ew-size-up')) {
        e.stopPropagation();
        this._wheelSize = parseFloat(Math.min(2.5, this._wheelSize + 0.15).toFixed(2));
        localStorage.setItem('dd-wheel-size', this._wheelSize);
        this._renderWheel(char, favs);
        return;
      }

      // Text/image mode toggle
      if (e.target.closest('#vn-ew-mode-toggle')) {
        e.stopPropagation();
        this._wheelTextMode = !this._wheelTextMode;
        localStorage.setItem('dd-wheel-text', this._wheelTextMode ? '1' : '0');
        this._renderWheel(char, favs);
        return;
      }

      // If clicking outside wheel, close
      const wheel = document.getElementById('vn-emotion-wheel');
      if (wheel && !wheel.contains(e.target)) {
        this.hideWheel();
        return;
      }
      
      // If clicking inside wheel but not on center - select hovered sector
      if (this._wheelCurrentHover >= 0) {
        const emoName = favs[this._wheelCurrentHover];
        if (emoName) {
          this.applyEmotion(char.id, emoName);
        }
        this.hideWheel();
      }
    };

    // Scroll handler for selection
    this._wheelScrollHandler = (e) => {
      if (!this._wheelOpen) return;
      e.preventDefault();
      
      const currentIdx = this._wheelCurrentHover >= 0 ? this._wheelCurrentHover : 0;
      const newIdx = (currentIdx + (e.deltaY > 0 ? 1 : -1) + favs.length) % favs.length;
      this._wheelCurrentHover = newIdx;
      this._highlightWheelSector(newIdx, char, favs);
    };

    document.addEventListener('mousemove', this._wheelMouseMoveHandler);
    document.addEventListener('mousedown', this._wheelClickHandler, true);
    document.addEventListener('wheel', this._wheelScrollHandler, { passive: false });

    // Direct click on center
    setTimeout(() => {
      const wheel = document.getElementById('vn-emotion-wheel');
      wheel?.querySelector('.vn-ew-center')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyEmotion(char.id, '');
        this.hideWheel();
      });
    }, 0);
  }

  static _getAngleIndex(x, y) {
    const dx = x - this._wheelX;
    const dy = y - this._wheelY;
    const dist = Math.hypot(dx, dy);

    // Scale hit-test radii with the current wheel size so they match the visual ring.
    // SVG constants: INNER_R = 50, OUTER_R = 144 (in a 300×300 viewBox).
    // The div is rendered at 300*sz px, so on-screen: innerR = 50*sz, outerR = 144*sz.
    const sz = Math.max(0.4, Math.min(2.5, this._wheelSize));
    const innerR = 50 * sz;
    const outerR = 144 * sz;

    // Inside center hole
    if (dist < innerR) return -1;

    // Outside outer ring
    if (dist > outerR) return -1;

    // Calculate angle: top = 0, clockwise
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const step = 360 / this._wheelFavs.length;
    return Math.floor(angle / step);
  }

  // ── Init - bind mouse events for wheel ────────────────────────────────────

  /** Returns true when the user has assigned a keyboard key to the emotion wheel. */
  static _hasKeybinding() {
    try {
      const bindings = game.keybindings.get(MODULE_ID, 'emotionWheel');
      return Array.isArray(bindings) && bindings.length > 0;
    } catch {
      return false;
    }
  }

  static init() {
    // Track mouse position so the keybinding can open wheel at cursor
    document.addEventListener('mousemove', (e) => {
      this._lastMouseX = e.clientX;
      this._lastMouseY = e.clientY;
    }, { passive: true });

    document.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return; // Middle mouse button
      // If the user has assigned a keyboard key, middle mouse is superseded.
      if (this._hasKeybinding()) return;
      if (!_state.open) return;
      const char = this._getPlayerChar();
      if (!char) return;
      const favs = this.getFavoritesForChar(char.id);
      if (favs.length === 0) return;
      e.preventDefault();
      this.showWheel(e.clientX, e.clientY);
    });

    document.addEventListener('auxclick', (e) => {
      // Suppress the default middle-click action only when middle mouse
      // is actually driving the wheel (i.e. no keybinding is assigned).
      if (e.button === 1 && !this._hasKeybinding()) e.preventDefault();
    });

    // Escape to close menus
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this._wheelOpen) this.hideWheel();
        else if (this._playerMenuOpen) {
          this._playerMenuOpen = false;
          this._renderPlayerMenu();
        }
        else if (this._activeCharId) this.hideEmotionPanel();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when the VN overlay is currently open. Used by keybindings in drama-director.mjs. */
export function isVNOpen() { return !!_state.open; }

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
export function initVNSystem() {
  if (initVNSystem.initialized) return;
  initVNSystem.initialized = true;
  DDVNPresets.register();
  DDVNEmotionManager.init();

  // Restore persistent master lists into state
  const masterLayers = DDVNPresets.getMasterLayers();
  if (masterLayers.length) _state.layers = deepClone(masterLayers);

  const masterIimgs = DDVNPresets.getMasterIimgs();
  if (masterIimgs.length) _state.interactiveImages = deepClone(masterIimgs);

  // Expose VN classes globally so the cinematic module can bridge into VN
  // without an ES module import (which is impossible across separate Foundry modules).
  globalThis.DDVNApi = DDVNApi;
  globalThis.DDVNEmotionManager = DDVNEmotionManager;
  globalThis.DDVNMic = DDVNMic;
  globalThis.DDVNOverlay = DDVNOverlay;
  globalThis.isVNOpen = isVNOpen;

  game.socket.on(SOCKET, (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'vn:state') {
      if (DDVNManager.isGmOnlyMode() && !game.user?.isGM) return;
      DDVNManager.applyRemote(data.state);
    } else if (data.type === 'vn:motion') {
      DDVNManager.receiveMotion(data);
    } else if (data.type === 'vn:subtitle') {
      DDVNOverlay.showSubtitle(data.name, data.text, data.color, data.charId, data.isFinal !== false);

    }
  });

  Hooks.on('getSceneControlButtons', (buttons) => {
    if (!game.user?.isGM) return;
    const tool = {
      name: 'vn',
      title: 'Visual Novel',
      icon: 'fas fa-book-open',
      onClick: () => DDVNApi.openPanel(),
      button: true
    };
    // Foundry V13: buttons is a plain object keyed by control name
    // Foundry V12: buttons is an Array with .find()
    if (Array.isArray(buttons)) {
      const tokenTools = buttons.find(b => b.name === 'token');
      if (tokenTools) tokenTools.tools.push(tool);
    } else if (buttons && typeof buttons === 'object') {
      // V13 — keys are control names, value has .tools array or similar
      const tokenCtrl = buttons['token'] ?? buttons['tokens'];
      if (tokenCtrl) {
        if (Array.isArray(tokenCtrl.tools)) tokenCtrl.tools.push(tool);
        else if (tokenCtrl.tools && typeof tokenCtrl.tools === 'object') {
          tokenCtrl.tools['vn'] = tool;
        }
      }
    }
  });
}
