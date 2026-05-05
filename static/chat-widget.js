(function () {
  'use strict';

  // スクリプトのsrcからAPIのベースURLを取得
  const script = document.currentScript;
  if (!script) return;
  const BASE_URL = script.src.replace(/\/chat-widget\.js(\?.*)?$/, '');

  // ---- スタイル ----
  const style = document.createElement('style');
  style.textContent = `
    #fdc-widget * { box-sizing: border-box; margin: 0; padding: 0; }
    #fdc-widget { font-family: 'Hiragino Sans', 'Meiryo', 'Yu Gothic', sans-serif; }

    #fdc-btn {
      position: fixed; bottom: 24px; right: 24px;
      width: 60px; height: 60px; border-radius: 50%;
      background: #1A73A7; color: white; border: none;
      font-size: 26px; cursor: pointer; z-index: 99998;
      box-shadow: 0 4px 14px rgba(26,115,167,0.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #fdc-btn:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(26,115,167,0.55); }

    #fdc-window {
      position: fixed; bottom: 96px; right: 24px;
      width: 360px; height: 510px;
      background: white; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      z-index: 99999; display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; transform: scale(0.92) translateY(16px); pointer-events: none;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    #fdc-window.fdc-open {
      opacity: 1; transform: scale(1) translateY(0); pointer-events: auto;
    }

    #fdc-header {
      background: #1A73A7; color: white;
      padding: 13px 16px;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .fdc-hinfo { display: flex; align-items: center; gap: 10px; }
    .fdc-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    .fdc-htitle { font-size: 0.93rem; font-weight: 700; }
    .fdc-hsub { font-size: 0.7rem; opacity: 0.82; margin-top: 2px; }
    #fdc-close {
      background: none; border: none; color: white;
      font-size: 20px; cursor: pointer; opacity: 0.75; line-height: 1;
    }
    #fdc-close:hover { opacity: 1; }

    #fdc-msgs {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 10px;
      background: #F2F8FC;
    }
    #fdc-msgs::-webkit-scrollbar { width: 4px; }
    #fdc-msgs::-webkit-scrollbar-thumb { background: #C0D8E8; border-radius: 2px; }

    .fdc-msg {
      max-width: 82%; padding: 9px 13px;
      font-size: 0.86rem; line-height: 1.65;
      white-space: pre-wrap; word-break: break-word;
    }
    .fdc-bot {
      background: white; border: 1px solid #DDE8F0;
      border-radius: 4px 14px 14px 14px;
      align-self: flex-start; color: #2D3748;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .fdc-user {
      background: #1A73A7; color: white;
      border-radius: 14px 4px 14px 14px;
      align-self: flex-end;
    }

    .fdc-typing {
      display: flex; gap: 5px; align-items: center;
      padding: 10px 13px; background: white;
      border: 1px solid #DDE8F0;
      border-radius: 4px 14px 14px 14px;
      align-self: flex-start; width: fit-content;
    }
    .fdc-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #90AABB; animation: fdcBounce 1.1s infinite ease-in-out;
    }
    .fdc-dot:nth-child(2) { animation-delay: 0.18s; }
    .fdc-dot:nth-child(3) { animation-delay: 0.36s; }
    @keyframes fdcBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-7px); }
    }

    #fdc-footer {
      padding: 10px 12px; border-top: 1px solid #E2EAF0;
      background: white; display: flex; gap: 8px; align-items: center; flex-shrink: 0;
    }
    #fdc-input {
      flex: 1; border: 1.5px solid #C8D8E4; border-radius: 22px;
      padding: 9px 15px; font-size: 0.86rem; outline: none;
      font-family: inherit; transition: border-color 0.18s;
      height: 40px; background: #F8FAFC;
    }
    #fdc-input:focus { border-color: #1A73A7; background: white; }
    #fdc-send {
      width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
      background: #1A73A7; border: none; color: white;
      font-size: 17px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.18s;
    }
    #fdc-send:hover:not(:disabled) { background: #125A8A; }
    #fdc-send:disabled { background: #B0C4D0; cursor: not-allowed; }

    #fdc-notice {
      font-size: 0.65rem; color: #94A3B8; text-align: center;
      padding: 4px 12px 6px; background: white; flex-shrink: 0;
    }

    @media (max-width: 420px) {
      #fdc-window { width: calc(100vw - 16px); right: 8px; bottom: 82px; }
      #fdc-btn { bottom: 16px; right: 12px; width: 52px; height: 52px; font-size: 22px; }
    }
  `;
  document.head.appendChild(style);

  // ---- DOM構築 ----
  const wrap = document.createElement('div');
  wrap.id = 'fdc-widget';
  wrap.innerHTML = `
    <button id="fdc-btn" aria-label="チャットを開く" title="ふじもと歯科 AIチャット">💬</button>
    <div id="fdc-window" role="dialog" aria-label="ふじもと歯科 AIアシスタント" aria-hidden="true">
      <div id="fdc-header">
        <div class="fdc-hinfo">
          <div class="fdc-avatar">🦷</div>
          <div>
            <div class="fdc-htitle">ふじもと歯科 AIアシスタント</div>
            <div class="fdc-hsub">堺市 ｜ お気軽にご質問ください</div>
          </div>
        </div>
        <button id="fdc-close" aria-label="閉じる">✕</button>
      </div>
      <div id="fdc-msgs" aria-live="polite"></div>
      <div id="fdc-footer">
        <input id="fdc-input" type="text" placeholder="メッセージを入力..." maxlength="200" autocomplete="off" />
        <button id="fdc-send" aria-label="送信">&#9658;</button>
      </div>
      <div id="fdc-notice">AIの回答は参考情報です。詳細はお電話またはフォームにて</div>
    </div>
  `;
  document.body.appendChild(wrap);

  // ---- ロジック ----
  const winEl   = document.getElementById('fdc-window');
  const btnEl   = document.getElementById('fdc-btn');
  const closeEl = document.getElementById('fdc-close');
  const msgsEl  = document.getElementById('fdc-msgs');
  const inputEl = document.getElementById('fdc-input');
  const sendEl  = document.getElementById('fdc-send');

  const history = [];
  let loading = false;
  let initialized = false;

  function open() {
    winEl.classList.add('fdc-open');
    winEl.setAttribute('aria-hidden', 'false');
    btnEl.textContent = '✕';
    btnEl.setAttribute('aria-label', 'チャットを閉じる');
    if (!initialized) {
      initialized = true;
      addBot('こんにちは！ふじもと歯科のAIアシスタントです。\n診療時間・料金・治療についてお気軽にご質問ください 😊');
    }
    setTimeout(() => inputEl.focus(), 260);
  }

  function close() {
    winEl.classList.remove('fdc-open');
    winEl.setAttribute('aria-hidden', 'true');
    btnEl.textContent = '💬';
    btnEl.setAttribute('aria-label', 'チャットを開く');
  }

  function toggle() {
    winEl.classList.contains('fdc-open') ? close() : open();
  }

  function addMsg(text, cls) {
    const div = document.createElement('div');
    div.className = 'fdc-msg ' + cls;
    div.textContent = text;
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  function addBot(text) { return addMsg(text, 'fdc-bot'); }
  function addUser(text) { return addMsg(text, 'fdc-user'); }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'fdc-typing'; el.id = 'fdc-typing';
    el.innerHTML = '<span class="fdc-dot"></span><span class="fdc-dot"></span><span class="fdc-dot"></span>';
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('fdc-typing');
    if (el) el.remove();
  }

  async function send() {
    const text = inputEl.value.trim();
    if (!text || loading) return;

    loading = true;
    sendEl.disabled = true;
    inputEl.value = '';

    addUser(text);
    showTyping();

    try {
      const res = await fetch(BASE_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice() }),
      });

      const data = await res.json();
      hideTyping();

      if (!res.ok) throw new Error(data.error || 'エラー');

      addBot(data.reply);

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: data.reply });
      if (history.length > 12) history.splice(0, 2);

    } catch (_) {
      hideTyping();
      addBot('申し訳ありません、一時的なエラーが発生しました。\nお電話（050-1808-5701）にてお問い合わせください。');
    } finally {
      loading = false;
      sendEl.disabled = false;
      inputEl.focus();
    }
  }

  btnEl.addEventListener('click', toggle);
  closeEl.addEventListener('click', close);
  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

})();
