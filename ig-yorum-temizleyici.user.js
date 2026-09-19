// ==UserScript==
// @name         IG Yorum Temizleyici
// @namespace    ig-comment-cleaner
// @version      1.1
// @description  Instagram'daki kendi geçmiş yorumlarınızı kontrollü, ayarlanabilir ve otomatik-kurtarmalı şekilde toplu silin.
// @match        https://www.instagram.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   *  AYARLAR (localStorage'da saklanır, panelden değiştirilir)
   * ============================================================ */
  const CONFIG_KEY = 'igcc_config_v1';
  const STATE_KEY  = 'igcc_state_v1';

  const DEFAULT_CONFIG = {
    username: 'pete_castigl1one',
    batchMin: 10,
    batchMax: 20,
    delayMin: 500,
    delayMax: 1000,
    waitAfterDeleteMin: 4000,
    waitAfterDeleteMax: 7000,
    preDeleteDelayMin: 600,
    preDeleteDelayMax: 1400,
    preConfirmDelayMin: 700,
    preConfirmDelayMax: 1600,
    autoRecover: true,
    offsetX: 28
  };

  const DEFAULT_STATE = {
    running: false,      // kullanıcı Başlat'a bastı mı / devam etmeli mi
    needsResume: false,  // hata sonrası sayfa yenilendiyse, otomatik devam etsin mi
    totalDeleted: 0
  };

  const loadJSON = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
    } catch (e) {
      return { ...fallback };
    }
  };
  const saveJSON = (key, obj) => localStorage.setItem(key, JSON.stringify(obj));

  let CONFIG = loadJSON(CONFIG_KEY, DEFAULT_CONFIG);
  let STATE  = loadJSON(STATE_KEY, DEFAULT_STATE);
  const saveConfig = () => saveJSON(CONFIG_KEY, CONFIG);
  const saveState  = () => saveJSON(STATE_KEY, STATE);

  // Döngüyü canlı olarak durdurabilmek için bellek-içi bayrak
  let RUNNING = false;

  /* ============================================================
   *  YARDIMCI FONKSİYONLAR
   * ============================================================ */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand  = ([a, b]) => a + Math.random() * (b - a);
  const randInt = ([a, b]) => Math.floor(rand([a, b + 1]));
  const randSleep = (range) => sleep(rand(range));

  const POLL_INTERVAL = 200;
  const DIALOG_WAIT_TIMEOUT = 6000;
  const DIALOG_CLOSE_TIMEOUT = 6000;
  const SELECT_BTN_WAIT_TIMEOUT = 8000;
  const SELECT_STABLE_CHECKS = 3;
  const SCROLLER_WAIT_TIMEOUT = 8000;
  const MICRO_DELAY = [80, 220];
  const POST_SELECT_CLICK_DELAY = [500, 1200];

  const selectedCount = () => {
    const m = document.body.innerText.match(/(\d+)\s+seçildi/);
    return m ? +m[1] : 0;
  };

  const press = (el, x, y) => {
    const o = { bubbles: true, cancelable: true, composed: true, view: window,
                clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...o, buttons: 1 }));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
  };

  const getDialogs = () => Array.from(document.querySelectorAll('div[role="dialog"], div[aria-modal="true"]'));

  const findConfirmBtn = (root, exclude) => {
    return Array.from(root.querySelectorAll('button, div[role="button"]')).find(el => {
      if (el === exclude) return false;
      const txt = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      return txt === 'Sil' || txt === 'Delete' || aria === 'Sil' || aria === 'Delete';
    });
  };

  const findSelectSpan = () => {
    return Array.from(document.querySelectorAll('span')).find(el =>
      el.textContent.trim() === 'Seç' || el.textContent.trim() === 'Select'
    );
  };

  const clickWithFallbacks = async (el) => {
    const innerSpan = el.querySelector('span');
    if (innerSpan) { innerSpan.click(); await randSleep(MICRO_DELAY); }
    el.click();
    await randSleep(MICRO_DELAY);
    const r = el.getBoundingClientRect();
    press(el, r.left + r.width / 2, r.top + r.height / 2);
  };

  // "Seç" span'i toggle davranışı gösterdiği için SADECE TEK tıklama.
  const clickSpanOnce = (span) => span.click();

  const waitForStableSelectSpan = async (timeout) => {
    let stableCount = 0, lastRectStr = null;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!RUNNING) return null;
      const candidate = findSelectSpan();
      if (candidate) {
        const r = candidate.getBoundingClientRect();
        const rectStr = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
        stableCount = (rectStr === lastRectStr && r.width > 0 && r.height > 0) ? stableCount + 1 : 1;
        lastRectStr = rectStr;
        if (stableCount >= SELECT_STABLE_CHECKS) return candidate;
      } else {
        stableCount = 0; lastRectStr = null;
      }
      await sleep(POLL_INTERVAL);
    }
    return null;
  };

  const findScroller = () => {
    const scrollers = [...document.querySelectorAll('div')].filter(el => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) &&
             el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 300;
    });
    return scrollers.find(el => !scrollers.some(o => o !== el && el.contains(o))) || null;
  };

  const waitForScroller = async (timeout) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!RUNNING) return null;
      const s = findScroller();
      if (s && document.body.contains(s)) return s;
      await sleep(POLL_INTERVAL);
    }
    return null;
  };

  const getRows = (scroller) => {
    const sr = scroller.getBoundingClientRect();
    const rows = [];
    document.querySelectorAll('[data-testid="post_collection_item"]').forEach(th => {
      const box = th.parentElement;
      if (!box || !box.textContent.trim().startsWith(CONFIG.username)) return;
      const r = th.getBoundingClientRect();
      const cx = r.right + CONFIG.offsetX, cy = r.top + r.height / 2;
      if (cy < sr.top + 10 || cy > sr.top + sr.height * 0.85) return;
      rows.push({ th, cx, cy });
    });
    return rows;
  };

  /* ============================================================
   *  KONTROL PANELİ (Shadow DOM ile Instagram CSS'inden izole)
   * ============================================================ */
  let logBox, statusEl, startBtn, stopBtn, deletedEl;

  function buildPanel() {
    const host = document.createElement('div');
    host.id = 'igcc-host';
    host.style.cssText = 'position:fixed; bottom:16px; right:16px; z-index:2147483647;';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
        .panel { width: 300px; background: #1c1e21; color: #f0f2f5; border-radius: 10px;
                 box-shadow: 0 4px 24px rgba(0,0,0,0.5); border: 1px solid #333; overflow: hidden; }
        .header { padding: 8px 10px; background: #26282b; cursor: move; display:flex; justify-content:space-between; align-items:center; }
        .header b { font-size: 13px; }
        .body { padding: 10px; max-height: 70vh; overflow-y: auto; }
        .row { display:flex; gap:6px; margin-bottom:6px; }
        .row label { flex: 1; font-size: 11px; color:#aab; align-self:center; }
        .row input { width: 60px; background:#111; color:#eee; border:1px solid #444; border-radius:4px; padding:3px 5px; font-size:12px; }
        .row input[type=text] { width: 120px; }
        .row input[type=checkbox] { width:auto; }
        .btns { display:flex; gap:6px; margin: 8px 0 6px; }
        button.act { flex:1; padding:7px; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; }
        .start { background:#31a73b; color:#fff; }
        .start:disabled { background:#345; color:#889; cursor:not-allowed; }
        .stop { background:#c0392b; color:#fff; }
        .stop:disabled { background:#345; color:#889; cursor:not-allowed; }
        .status { font-size:11px; color:#9ad; margin-bottom:4px; }
        .log { background:#0e0f11; border:1px solid #333; border-radius:6px; padding:6px;
               height: 130px; overflow-y:auto; font-size:10.5px; line-height:1.4; }
        .log .ok { color:#4cd137; } .log .err { color:#ff5555; } .log .warn { color:#f5c518; } .log .info { color:#9ad; }
        .collapsed .body { display:none; }
        .minbtn { cursor:pointer; font-size:14px; opacity:0.7; }
      </style>
      <div class="panel" id="panel">
        <div class="header" id="header">
          <b>🧹 IG Yorum Temizleyici</b>
          <span class="minbtn" id="minbtn">—</span>
        </div>
        <div class="body">
          <div class="status" id="status">Durum: Beklemede</div>
          <div class="status" id="deleted">Toplam silinen: 0</div>

          <div class="row"><label>Kullanıcı adı</label><input type="text" id="cfg-username"></div>
          <div class="row"><label>Batch (min-max)</label><input type="number" id="cfg-batchMin"><input type="number" id="cfg-batchMax"></div>
          <div class="row"><label>Seçim gecikmesi ms</label><input type="number" id="cfg-delayMin"><input type="number" id="cfg-delayMax"></div>
          <div class="row"><label>Silme sonrası mola ms</label><input type="number" id="cfg-waitMin"><input type="number" id="cfg-waitMax"></div>
          <div class="row"><label>Otomatik kurtarma (hatada sayfayı yenile)</label><input type="checkbox" id="cfg-autoRecover"></div>

          <div class="btns">
            <button class="act start" id="startBtn">Başlat</button>
            <button class="act stop" id="stopBtn">Durdur</button>
          </div>

          <div class="log" id="log"></div>
        </div>
      </div>
    `;

    // Değerleri forma yükle
    shadow.getElementById('cfg-username').value = CONFIG.username;
    shadow.getElementById('cfg-batchMin').value = CONFIG.batchMin;
    shadow.getElementById('cfg-batchMax').value = CONFIG.batchMax;
    shadow.getElementById('cfg-delayMin').value = CONFIG.delayMin;
    shadow.getElementById('cfg-delayMax').value = CONFIG.delayMax;
    shadow.getElementById('cfg-waitMin').value = CONFIG.waitAfterDeleteMin;
    shadow.getElementById('cfg-waitMax').value = CONFIG.waitAfterDeleteMax;
    shadow.getElementById('cfg-autoRecover').checked = CONFIG.autoRecover;

    const readConfigFromForm = () => {
      CONFIG.username = shadow.getElementById('cfg-username').value.trim() || DEFAULT_CONFIG.username;
      CONFIG.batchMin = +shadow.getElementById('cfg-batchMin').value || DEFAULT_CONFIG.batchMin;
      CONFIG.batchMax = +shadow.getElementById('cfg-batchMax').value || DEFAULT_CONFIG.batchMax;
      CONFIG.delayMin = +shadow.getElementById('cfg-delayMin').value || DEFAULT_CONFIG.delayMin;
      CONFIG.delayMax = +shadow.getElementById('cfg-delayMax').value || DEFAULT_CONFIG.delayMax;
      CONFIG.waitAfterDeleteMin = +shadow.getElementById('cfg-waitMin').value || DEFAULT_CONFIG.waitAfterDeleteMin;
      CONFIG.waitAfterDeleteMax = +shadow.getElementById('cfg-waitMax').value || DEFAULT_CONFIG.waitAfterDeleteMax;
      CONFIG.autoRecover = shadow.getElementById('cfg-autoRecover').checked;
      saveConfig();
    };
    shadow.querySelectorAll('input').forEach(inp => inp.addEventListener('change', readConfigFromForm));

    // Sürükleme
    const panelEl = shadow.getElementById('panel');
    const headerEl = shadow.getElementById('header');
    let dragging = false, offX = 0, offY = 0;
    headerEl.addEventListener('mousedown', (e) => {
      dragging = true;
      const r = host.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      host.style.left = (e.clientX - offX) + 'px';
      host.style.top = (e.clientY - offY) + 'px';
      host.style.right = 'auto'; host.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => dragging = false);

    // Küçült/Büyüt
    shadow.getElementById('minbtn').addEventListener('click', () => panelEl.classList.toggle('collapsed'));

    logBox = shadow.getElementById('log');
    statusEl = shadow.getElementById('status');
    deletedEl = shadow.getElementById('deleted');
    startBtn = shadow.getElementById('startBtn');
    stopBtn = shadow.getElementById('stopBtn');

    startBtn.addEventListener('click', () => { readConfigFromForm(); userStart(); });
    stopBtn.addEventListener('click', () => userStop());

    updateStatus('Beklemede');
    deletedEl.textContent = `Toplam silinen: ${STATE.totalDeleted}`;
  }

  function log(msg, type = 'info') {
    const time = new Date().toLocaleTimeString('tr-TR');
    console.log(`[IGCC ${time}] ${msg}`);
    if (!logBox) return;
    const line = document.createElement('div');
    line.className = type;
    line.textContent = `[${time}] ${msg}`;
    logBox.appendChild(line);
    while (logBox.children.length > 200) logBox.removeChild(logBox.firstChild);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function updateStatus(text) { if (statusEl) statusEl.textContent = `Durum: ${text}`; }
  function updateDeleted() { if (deletedEl) deletedEl.textContent = `Toplam silinen: ${STATE.totalDeleted}`; }
  function setButtons(isRunning) {
    if (!startBtn) return;
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
  }

  /* ============================================================
   *  BAŞLAT / DURDUR
   * ============================================================ */
  function userStart() {
    if (RUNNING) return;
    STATE.running = true; STATE.needsResume = false; saveState();
    RUNNING = true;
    setButtons(true);
    updateStatus('Çalışıyor');
    log('Otomasyon başlatıldı.', 'ok');
    mainLoopWrapper();
  }

  function userStop() {
    RUNNING = false;
    STATE.running = false; STATE.needsResume = false; saveState();
    setButtons(false);
    updateStatus('Durduruldu (kullanıcı)');
    log('Otomasyon kullanıcı tarafından durduruldu.', 'warn');
  }

  // Kritik bir hata olduğunda çağrılır: ya sayfayı yenileyip devam eder ya da tamamen durur.
  async function handleFailure(reason) {
    log(`HATA: ${reason}`, 'err');
    if (CONFIG.autoRecover) {
      STATE.running = true; STATE.needsResume = true; saveState();
      updateStatus('Hata — sayfa yenileniyor...');
      log('Otomatik kurtarma açık: sayfa birkaç saniye içinde yenilenip kaldığı yerden devam edecek.', 'warn');
      await sleep(rand([3000, 6000]));
      location.reload();
    } else {
      RUNNING = false;
      STATE.running = false; STATE.needsResume = false; saveState();
      setButtons(false);
      updateStatus('Durduruldu (hata)');
      log('Otomatik kurtarma kapalı — otomasyon durduruldu. Sorunu giderip "Başlat"a tekrar basabilirsin.', 'err');
    }
  }

  async function mainLoopWrapper() {
    try {
      await runAutomation();
      // Buraya normal şartlarda gelinmez (döngü RUNNING=false olunca çıkar);
      // gelirse "liste sonu" gibi doğal bir bitiş olmuştur.
      if (RUNNING) {
        RUNNING = false;
        STATE.running = false; STATE.needsResume = false; saveState();
        setButtons(false);
        updateStatus('Tamamlandı');
        log('Silinecek yorum kalmadı, otomasyon tamamlandı.', 'ok');
      }
    } catch (err) {
      await handleFailure(err && err.message ? err.message : String(err));
    }
  }

  /* ============================================================
   *  ANA OTOMASYON DÖNGÜSÜ
   * ============================================================ */
  async function runAutomation() {
    const initialSelectSpan = findSelectSpan();
    if (initialSelectSpan) {
      log('Seçim modunda değiliz, "Seç" butonuna otomatik basılıyor...');
      await randSleep(POST_SELECT_CLICK_DELAY);
      clickSpanOnce(initialSelectSpan);
      await sleep(800);
    }

    let scroller = await waitForScroller(SCROLLER_WAIT_TIMEOUT);
    if (!scroller) { await handleFailure('Kaydırılabilir yorum listesi bulunamadı. Doğru sayfada mısın? (Hareketlerin > Yorumlar)'); return; }
    scroller.scrollTop = 0;
    await sleep(800);

    const done = new WeakSet();
    let fails = 0, stagnant = 0;

    log(`Otomasyon çalışıyor: ${CONFIG.batchMin}-${CONFIG.batchMax} arası rastgele paketler halinde siliniyor.`);

    while (stagnant < 5 && RUNNING) {

      if (!scroller || !document.body.contains(scroller)) {
        log('Liste elementi değişmiş, yeniden bulunuyor...');
        scroller = await waitForScroller(SCROLLER_WAIT_TIMEOUT);
        if (!scroller) { await handleFailure('Yeniden render sonrası liste bulunamadı.'); return; }
        scroller.scrollTop = 0;
        await sleep(800);
      }

      const batchSize = randInt([CONFIG.batchMin, CONFIG.batchMax]);
      const goal = selectedCount() + batchSize;
      log(`Bu tur hedefi: ${batchSize} yorum.`);
      let selectionMadeInThisBatch = false;

      // 1. FAZ: Seçim
      while (selectedCount() < goal && stagnant < 5 && RUNNING) {
        if (!scroller || !document.body.contains(scroller)) {
          scroller = await waitForScroller(SCROLLER_WAIT_TIMEOUT);
          if (!scroller) { await handleFailure('Seçim sırasında liste elementi kayboldu.'); return; }
        }

        selectionMadeInThisBatch = false;

        for (const row of getRows(scroller)) {
          if (!RUNNING) return;
          if (done.has(row.th)) continue;
          done.add(row.th);

          let target = document.elementFromPoint(row.cx, row.cy);
          if (!target) continue;

          const before = selectedCount();
          press(target, row.cx, row.cy);
          await sleep(350);
          const after = selectedCount();

          if (after < before) {
            target = document.elementFromPoint(row.cx, row.cy);
            press(target, row.cx, row.cy);
            await sleep(350);
          } else if (after === before) {
            if (++fails >= 3) { await handleFailure('3 tıklama üst üste başarısız oldu.'); return; }
            continue;
          } else {
            fails = 0;
            selectionMadeInThisBatch = true;
          }

          if (selectedCount() >= goal) break;
          await randSleep([CONFIG.delayMin, CONFIG.delayMax]);
        }

        if (!selectionMadeInThisBatch) {
          const top = scroller.scrollTop;
          scroller.scrollBy(0, scroller.clientHeight * 0.6);
          await sleep(1200);
          stagnant = scroller.scrollTop === top ? stagnant + 1 : 0;
        } else {
          stagnant = 0;
        }
      }

      if (!RUNNING) return;

      // 2. FAZ: Silme
      const currentSelected = selectedCount();
      if (currentSelected > 0) {
        log(`${currentSelected} yorum seçildi, silme butonuna basılıyor...`);

        const bottomDeleteBtn = Array.from(document.querySelectorAll('div[role="button"]')).find(el => {
          const aria = el.getAttribute('aria-label');
          return aria === 'Sil' || aria === 'Delete' || (aria && (aria.startsWith('Sil (') || aria.startsWith('Delete (')));
        });
        if (!bottomDeleteBtn) { await handleFailure('Ekranın altındaki ana Sil butonu bulunamadı.'); return; }

        await randSleep([CONFIG.preDeleteDelayMin, CONFIG.preDeleteDelayMax]);
        const dialogsBefore = new Set(getDialogs());
        await clickWithFallbacks(bottomDeleteBtn);

        // 3. FAZ: Onay popup'ı
        let newDialog = null;
        const dialogWaitStart = Date.now();
        while (Date.now() - dialogWaitStart < DIALOG_WAIT_TIMEOUT) {
          if (!RUNNING) return;
          await sleep(POLL_INTERVAL);
          newDialog = getDialogs().find(d => !dialogsBefore.has(d) && findConfirmBtn(d, bottomDeleteBtn));
          if (newDialog) break;
        }
        if (!newDialog) { await handleFailure('Yeni onay popup\'ı açılmadı / bulunamadı.'); return; }

        await randSleep([CONFIG.preConfirmDelayMin, CONFIG.preConfirmDelayMax]);
        const finalConfirm = findConfirmBtn(newDialog, bottomDeleteBtn);
        if (!finalConfirm) { await handleFailure('Popup içinde onay (Sil) butonu bulunamadı.'); return; }

        await clickWithFallbacks(finalConfirm);

        let closed = false;
        const closeWaitStart = Date.now();
        while (Date.now() - closeWaitStart < DIALOG_CLOSE_TIMEOUT) {
          if (!RUNNING) return;
          await sleep(POLL_INTERVAL);
          if (!document.body.contains(newDialog)) { closed = true; break; }
        }
        if (!closed) { await handleFailure('Onay popup\'ı kapanmadı — silme başarısız olmuş olabilir.'); return; }

        let afterDeleteSelected = selectedCount();
        const settleStart = Date.now();
        while (afterDeleteSelected >= currentSelected && Date.now() - settleStart < DIALOG_CLOSE_TIMEOUT) {
          if (!RUNNING) return;
          await sleep(POLL_INTERVAL);
          afterDeleteSelected = selectedCount();
        }

        if (afterDeleteSelected >= currentSelected) {
          log(`Uyarı: seçili sayısı hâlâ ${afterDeleteSelected}. Silme tam doğrulanamadı.`, 'warn');
        } else {
          STATE.totalDeleted += currentSelected;
          saveState();
          updateDeleted();
          log(`${currentSelected} yorum silindi (Toplam: ${STATE.totalDeleted}).`, 'ok');
        }

        await randSleep([CONFIG.waitAfterDeleteMin, CONFIG.waitAfterDeleteMax]);
        if (!RUNNING) return;

        const selectSpan = await waitForStableSelectSpan(SELECT_BTN_WAIT_TIMEOUT);
        if (!selectSpan) { await handleFailure('"Seç" butonu stabil şekilde bulunamadı.'); return; }

        await randSleep(POST_SELECT_CLICK_DELAY);
        clickSpanOnce(selectSpan);
        log('"Seç" butonuna tekrar basıldı, seçim modu yeniden açıldı.');
        await sleep(800);

        scroller = await waitForScroller(SCROLLER_WAIT_TIMEOUT);
        if (!scroller) { await handleFailure('"Seç" sonrası liste elementi bulunamadı.'); return; }
        scroller.scrollTop = 0;
        await sleep(800);

        stagnant = 0;
      } else if (stagnant >= 5) {
        log('Listenin sonuna gelindi veya silinecek yorum kalmadı.', 'ok');
      }
    }
  }

  /* ============================================================
   *  BAŞLANGIÇ: paneli oluştur, hata-sonrası otomatik devam kontrolü
   * ============================================================ */
  function init() {
    buildPanel();

    if (STATE.running && STATE.needsResume) {
      log('Önceki oturumda hata sonrası kurtarma bekleniyor, otomatik devam ediliyor...', 'warn');
      updateStatus('Yeniden başlatılıyor...');
      setButtons(true);
      RUNNING = true;
      STATE.needsResume = false; saveState();
      setTimeout(() => mainLoopWrapper(), rand([2000, 4000]));
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 500);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  }
})();
