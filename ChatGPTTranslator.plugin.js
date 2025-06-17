/**
 * @name ChatGPTTranslator
 * @author Sheiylanie
 * @authorId 183948625368317952
 * @version 8.11.3
 * @description Automatically translate messages from OpenAI API in real-time.
 * @invite hhACcDHCsc
 * @donate https://www.paypal.com/paypalme/Sheiylanie
 * @website https://novarise-studio.com
 * @source https://github.com/SheiylaDev/ChatGPTTranslator/blob/main/ChatGPTTranslator.plugin.js
 * @updateUrl https://raw.githubusercontent.com/SheiylaDev/ChatGPTTranslator/main/ChatGPTTranslator.plugin.js
 */

class ChatGPTTranslator {
  constructor() {
    this.id = "ChatGPTTranslator";
    BdApi.Patcher.unpatchAll(this.id);
    this.settings = {
      apiKey: "",
      enabledChannels: [],
      translateIncoming: true,
      translateOutgoing: true,
      incomingTargetLang: "English",
      langPerChannel: {},
      model: "gpt-4o-mini",
      ...BdApi.loadData(this.id, "settings")
    };
    this.lastSent = {};
    this.observer = null;
    this.cache = { translation: {}, detection: {} };
    this.saveTimeout = null;
    this.queue = [];
    this.queueProcessing = false;
    this.active = false;
    this.injectButton = this.injectButton.bind(this);
    this.Disp = null;
  }

  start() {
    this.active = true;
    if (this.settings.translateOutgoing && this.settings.enabledChannels.length > 0) this.patchSend();
    this.hookDispatcher();
    this.startObserver();
    this.toast(`${this.id} OK`, this.settings.apiKey ? "success" : "warning");
  }

  stop() {
    this.active = false;
    BdApi.Patcher.unpatchAll(this.id);
    this.unhookDispatcher();
    this.stopObserver();
    this.queue = [];
    this.toast(`${this.id} stopped`, "warning");
  }

  save() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      BdApi.saveData(this.id, "settings", this.settings);
      this.saveTimeout = null;
    }, 200);
  }

  toast(m, t = "info") { BdApi.showToast(m, { type: t }); }

  currentCid = () => {
    const Sel = BdApi.findModuleByProps("getCurrentlySelectedChannelId", "getChannelId");
    return Sel?.getCurrentlySelectedChannelId?.() || Sel?.getChannelId?.();
  }

  channelAllowed = cid => this.settings.enabledChannels.includes(cid);

  toggleChannel = cid => {
    const arr = this.settings.enabledChannels;
    const i = arr.indexOf(cid);
    let enabled;
    if (i === -1) {
      arr.push(cid);
      if (!this.settings.langPerChannel[cid])
        this.settings.langPerChannel[cid] = this.settings.incomingTargetLang;
      enabled = true;
    } else {
      arr.splice(i, 1);
      enabled = false;
    }
    this.save();
    BdApi.Patcher.unpatchAll(this.id);
    if (this.settings.translateOutgoing && this.settings.enabledChannels.length > 0) this.patchSend();
    this.toast(`Translation ${enabled ? "enabled" : "disabled"} for this channel`, enabled ? "success" : "warning");
  }

  flagForLang = lang => {
    const flags = {
      English: "🇺🇸", French: "🇫🇷", Spanish: "🇪🇸", German: "🇩🇪",
      Italian: "🇮🇹", Japanese: "🇯🇵", Chinese: "🇨🇳", Korean: "🇰🇷",
      Russian: "🇷🇺", Portuguese: "🇵🇹", Arabic: "🇸🇦", Dutch: "🇳🇱",
      Polish: "🇵🇱", Turkish: "🇹🇷", Hindi: "🇮🇳", Ukrainian: "🇺🇦",
      Greek: "🇬🇷", Hebrew: "🇮🇱", Swedish: "🇸🇪", Norwegian: "🇳🇴",
      Danish: "🇩🇰", Finnish: "🇫🇮", Czech: "🇨🇳", Hungarian: "🇭🇺"
    };
    return flags[lang] || "🌐";
  }

  quoteen = t => `> 🌐 ` + t.replace(/\n/g, "\n> ");
  quote = (t, lang = this.settings.incomingTargetLang) => `> ${this.flagForLang(lang)} ` + t.replace(/\n/g, "\n> ");

  async translate(txt, to = "English") {
    if (!this.active) return txt;
    const key = (this.settings.apiKey || "").trim();
    const cacheKey = `${txt}::${to}`;
    if (this.cache.translation[cacheKey]) return this.cache.translation[cacheKey];
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: this.settings.model || "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: "You are a translation machine. Only output the translation, nothing else. No explanations, no quotes, no context, just the translated text."
            },
            { role: "user", content: `Translate to ${to}:\n\n${txt}` }
          ]
        })
      });
      if (res.status === 401) {
        this.toast("Invalid OpenAI API key (401 Unauthorized)", "error");
        return txt;
      }
      const data = await res.json();
      let result = data.choices?.[0]?.message?.content?.trim() || txt;
      if (/translates to/i.test(result)) {
        const match = result.match(/['‘'""""]?([a-zA-Z\- ]+)[.'''""""]?$/);
        if (match) result = match[1];
      }
      if (/^['"""'''].*['"""''']$/.test(result)) {
        result = result.replace(/^['"""''']|['"""''']$/g, "");
      }
      this.cache.translation[cacheKey] = result;
      return result;
    } catch (e) {
      console.error(`[${this.id}] OpenAI`, e);
      return txt;
    }
  }

  async detectLang(text) {
    if (!this.active) return "English";
    const key = (this.settings.apiKey || "").trim();
    if (!key) return "English";
    const cacheKey = text;
    if (this.cache.detection[cacheKey]) return this.cache.detection[cacheKey];
    const hasFr = /\b(le|la|les|un|une|des|est|et|à|de|pour|avec)\b/i.test(text);
    const hasEn = /\b(the|and|is|to|for|with|of|in|on|at)\b/i.test(text);
    if (!(hasFr && hasEn) && (hasFr || hasEn)) {
      return hasFr ? "French" : "English";
    }
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          messages: [
            {
              role: "system",
              content: "Detect the language name only (e.g. English, French)"
            },
            { role: "user", content: text }
          ]
        })
      });
      const data = await res.json();
      const result = data.choices?.[0]?.message?.content?.trim() || "English";
      this.cache.detection[cacheKey] = result;
      return result;
    } catch (e) {
      console.error(`[${this.id}] Language detection`, e);
      return "English";
    }
  }

  patchSend() {
    BdApi.Patcher.unpatchAll(this.id);
    if (!(this.settings.translateOutgoing && this.settings.enabledChannels.length > 0)) return;
    const Msg = BdApi.Webpack.getByKeys("_sendMessage");
    if (!Msg?.sendMessage) return;
    BdApi.Patcher.instead(this.id, Msg, "sendMessage", (that, args, original) => {
      const [cid, msg] = args;
      if (!this.channelAllowed(cid) || !this.settings.translateOutgoing || !msg?.content || !this.active) {
        return original.apply(that, args);
      }
      return (async () => {
        const fr = msg.content;
        const targetLang = this.settings.langPerChannel[cid] || this.settings.incomingTargetLang || "English";
        const translated = await this.translate(fr, targetLang);
        const ok = translated && translated !== fr;
        if (ok) {
          msg.content = translated;
          this.lastSent[cid] = { en: translated, fr };
        }
        return original.apply(that, args);
      })();
    });
  }

  async processQueue() {
    if (!this.active) return;
    if (this.queueProcessing) return;
    this.queueProcessing = true;
    while (this.queue.length > 0) {
      if (!this.active) break;
      const job = this.queue.shift();
      if (!job) continue;
      await this.handleTranslationJob(job);
    }
    this.queueProcessing = false;
  }

  async handleTranslationJob({ message, Disp, cid, lang, detectedLang, isSelf }) {
    if (!this.active) return;
    const content = message.content ? message.content.trim() : '';
    const urlOnly = /^(https?:\/\/\S+\s*)+$/i;
    const hasLetters = /[a-zA-ZÀ-ÿ]/.test(content);
    const isSticker = (message.stickerItems && message.stickerItems.length > 0) || (message.sticker_items && message.sticker_items.length > 0);
    const refProps = {};
    if (message.message_reference) refProps.message_reference = message.message_reference;
    if (message.referenced_message) refProps.referenced_message = message.referenced_message;
    if (message.reference) refProps.reference = message.reference;
    if (!content || content.length < 2 || urlOnly.test(content) || !hasLetters || isSticker) {
      Disp.dispatch({
        type: "MESSAGE_UPDATE",
        message: {
          ...message,
          content: message.content,
          ...refProps
        }
      });
      return;
    }
    Disp.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...message,
        content: `${this.quoteen(message.content)}\n[⏳ Translating...]`,
        ...refProps
      }
    });
    const [fr, detected] = await Promise.all([
      this.translate(message.content, lang),
      this.detectLang(message.content)
    ]);
    if (!fr || fr.trim().toLowerCase() === message.content.trim().toLowerCase()) {
      Disp.dispatch({
        type: "MESSAGE_UPDATE",
        message: {
          ...message,
          content: message.content,
          ...refProps
        }
      });
      return;
    }
    this.settings.langPerChannel[cid] = detected;
    this.save();
    Disp.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...message,
        content: `${this.quoteen(message.content, detected)}\n${this.quote(fr, lang)}`,
        ...refProps
      }
    });
  }

  hookDispatcher() {
    if (this.unsub) this.unhookDispatcher();
    const Disp = BdApi.findModuleByProps("dispatch", "subscribe");
    if (!Disp) return;
    this.Disp = Disp;
    const selfId = BdApi.findModuleByProps("getCurrentUser").getCurrentUser().id;
    this.unsub = Disp.subscribe("MESSAGE_CREATE", async ({ message }) => {
      if (!this.active) return;
      const cid = message.channel_id;
      if (!this.channelAllowed(cid)) return;
      const isSelf = message.author?.id === selfId;
      if (isSelf && this.lastSent[cid] && message.content === this.lastSent[cid].en) {
        const { fr, en } = this.lastSent[cid];
        Disp.dispatch({ type: "MESSAGE_UPDATE", message: { ...message, content: `${en}\n${this.quote(fr)}` } });
        delete this.lastSent[cid];
      } else if (!isSelf && this.settings.translateIncoming && !message.content.includes("\n> ")) {
        const lang = this.settings.incomingTargetLang;
        this.queue.push({ message, Disp, cid, lang, isSelf });
        this.processQueue();
      }
    });
  }

  unhookDispatcher() {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.Disp = null;
  }

  injectButton() {
    try {
      const bar = document.querySelector("div.channelTextArea__74017 div[class^='buttons__']");
      if (!bar || bar.querySelector(".cgt-btn")) return;
      const cid = this.currentCid();
      if (!cid) return;
      const wrap = document.createElement("div");
      wrap.className = "buttonContainer__74017";
      wrap.appendChild(this.buildBtn(cid));
      const first = bar.querySelector(":scope > .buttonContainer__74017, :scope > .container_c0c49a, :scope > button");
      first ? bar.insertBefore(wrap, first) : bar.appendChild(wrap);
    } catch (e) {
      console.error(`[${this.id}] injectButton`, e);
    }
  }

  buildBtn(cid) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "button__201d5 lookBlank__201d5 colorBrand__201d5 grow__201d5 cgt-btn";
    b.innerHTML = `<div class="contents__201d5 button__24af7 button__74017"><div class="buttonWrapper__24af7" style="display:flex;align-items:center;justify-content:center;width:19px;height:19px;margin-top:1px;">
    <svg fill="#8f8f91" 
      onmouseenter="this.setAttribute('fill', '#fbfbfb')"
      onmouseleave="this.setAttribute('fill', '#8f8f91')"
      viewBox="0 0 24 24" 
      role="img" 
      xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><title>OpenAI icon</title><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path></g></svg>
    </div></div>`;
    const refresh = () => { b.style.opacity = this.channelAllowed(cid) ? "1" : "0.35"; };
    refresh();
    b.title = "Enable/disable translator for this channel";
    b.onclick = () => { this.toggleChannel(cid); refresh(); };
    return b;
  }

  startObserver() {
    if (this.observer || typeof this.injectButton !== "function") return;
    let timeout;
    const debouncedInject = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => this.injectButton(), 100);
    };
    this.injectButton();
    this.observer = new MutationObserver(debouncedInject);
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  stopObserver() {
    if (!this.observer) return;
    this.observer.disconnect();
    this.observer = null;
    document.querySelectorAll(".cgt-btn").forEach(el => el.closest(".buttonContainer__74017")?.remove());
  }

  getSettingsPanel() {
    const sharedStyle = `display: block;width: 100%;padding: 8px 10px;font-size: 14px;border-radius: 6px;background: var(--background-secondary);border: 1px solid var(--background-modifier-border);color: var(--text-normal);margin-bottom: 16px;`;

    const wrap = document.createElement("div");
    wrap.style.cssText = "padding: 16px; font-family: sans-serif; color: var(--header-primary);";

    const warning = document.createElement("div");
    warning.innerHTML = `⚠️ <b>Beta:</b> This plugin is in beta. Expect frequent updates and possible changes.`;
    warning.style.cssText = "background:#ffbaba;color:#7a0000;padding:8px 10px;border-radius:6px;margin-bottom:16px;font-size:14px;";

    const keyLabel = document.createElement("label");
    keyLabel.textContent = "🔧 OpenAI API Key (starts with sk-)";
    keyLabel.style.cssText = "display:block;margin-bottom:4px;font-size:14px;font-weight:500;";

    const keyInput = Object.assign(document.createElement("input"), {
      type: "password",
      placeholder: "sk-...",
      value: this.settings.apiKey
    });

    keyInput.style.cssText = sharedStyle;
    keyInput.style.boxSizing = "border-box";

    keyInput.oninput = e => { this.settings.apiKey = e.target.value.trim(); this.save(); };

    const modelLabel = document.createElement("label");
    modelLabel.textContent = "🤖 OpenAI Model:";
    modelLabel.style.cssText = keyLabel.style.cssText;

    const modelSelect = document.createElement("select");
    [
      { value: "gpt-4o", label: "gpt-4o (fastest, best)" },
      { value: "gpt-4o-mini", label: "gpt-4o-mini (default, cheap)" },
      { value: "gpt-3.5-turbo", label: "gpt-3.5-turbo (legacy, cheap)" }
    ].forEach(optData => {
      const opt = document.createElement("option");
      opt.value = optData.value;
      opt.textContent = optData.label;
      if (this.settings.model === optData.value) opt.selected = true;
      modelSelect.appendChild(opt);
    });

    modelSelect.style.cssText = sharedStyle;
    modelSelect.style.boxSizing = "border-box";

    modelSelect.onchange = e => { this.settings.model = e.target.value; this.save(); };

    const langLabel = document.createElement("label");
    langLabel.textContent = "🌐 Target language for received messages:";
    langLabel.style.cssText = keyLabel.style.cssText;

    const langSelect = document.createElement("select");
    ["French", "English", "Spanish", "German", "Italian", "Japanese", "Russian", "Portuguese", "Arabic", "Dutch", "Polish", "Turkish", "Hindi", "Ukrainian", "Greek", "Hebrew", "Swedish", "Norwegian", "Danish", "Finnish", "Czech", "Hungarian"].forEach(lang => {
      const opt = document.createElement("option");
      opt.value = lang;
      opt.textContent = lang;
      if (this.settings.incomingTargetLang === lang) opt.selected = true;
      langSelect.appendChild(opt);
    });

    langSelect.style.cssText = sharedStyle;
    langSelect.style.boxSizing = "border-box";

    langSelect.onchange = e => { this.settings.incomingTargetLang = e.target.value; this.save(); };

    const info = document.createElement("div");
    info.innerHTML = `💡 You can create your API key at <a href="https://platform.openai.com/account/api-keys" target="_blank" style="color:var(--text-link)">platform.openai.com</a>`;
    info.style.cssText = "font-size:13px;line-height:1.4;";

    wrap.append(warning, keyLabel, keyInput, modelLabel, modelSelect, langLabel, langSelect, info);
    return wrap;
  }
};

module.exports = ChatGPTTranslator;
