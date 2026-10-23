window.kalkiAssistantState = window.kalkiAssistantState || "idle";
window.kalkiVoiceState = window.kalkiVoiceState || { active: false, listening: false, processing: false, status: "" };
function publishKalkiAssistantState(state) {
    window.kalkiAssistantState = state;
    window.dispatchEvent(new CustomEvent("kalki:assistant-state", { detail: { state } }));
    if (state === "solving") window.ensureKalkiEffects?.();
}

document.addEventListener("DOMContentLoaded", () => {
    const chatBox = document.getElementById("chat");
    const messageInput = document.getElementById("msg");
    const sendButton = document.getElementById("send");
    const clearButton = document.getElementById("clear-btn");
    const micButton = document.getElementById("mic-btn");
    const settingsToggle = document.getElementById("settings-toggle");
    const voiceSettings = document.getElementById("voice-settings");
    const apiKeyInput = document.getElementById("gemini-api-key");
    const apiKeyStatus = document.getElementById("gemini-key-status");
    const apiKeySettings = document.getElementById("gemini-api-settings");
    const saveApiKeyButton = document.getElementById("save-api-key");
    const clearApiKeyButton = document.getElementById("clear-api-key");
    const ttsAutoRead = document.getElementById("tts-auto-read");
    const ttsStopButton = document.getElementById("tts-stop-button");
    const ttsStatus = document.getElementById("tts-status");
    const ttsVoiceSelect = document.getElementById("tts-voice-select");
    const ttsVoiceHelp = document.getElementById("tts-voice-help");
    const voiceInputLanguage = document.getElementById("voice-input-language");
    const voiceModeStatus = document.getElementById("voice-mode-status");
    const desktopPairCodeInput = document.getElementById("desktop-pair-code");
    const desktopPairButton = document.getElementById("desktop-pair-button");
    const desktopUnpairButton = document.getElementById("desktop-unpair-button");
    const desktopAgentStatus = document.getElementById("desktop-agent-status");

    const MEMORY_KEY = "jarvis_chat_memory";
    const TTS_AUTO_READ_KEY = "kalki.tts.autoRead";
    const TTS_VOICE_KEY = "kalki.tts.voiceURI";
    const VOICE_INPUT_LANGUAGE_KEY = "kalki.voice.inputLanguage";
    const VOICE_STOP_PHRASES = new Set([
        "stop", "stop voice", "stop voice chat", "stop voice mode", "stop listening", "stop talking", "end voice chat", "end conversation", "voice off", "turn off voice", "turn off voice chat", "pause voice", "pause voice chat", "cancel voice", "cancel voice chat", "quit voice", "quit voice chat", "goodbye", "that's all", "that's enough",
        "aapu", "aapeyi", "aapey", "aapandi", "voice aapu", "voice aapeyi", "voice aapey", "voice aapandi", "chaalu", "chalu",
        "ఆపు", "ఆపేయి", "ఆపండి", "చాలు", "వాయిస్ ఆపు", "వాయిస్ ఆపేయి", "వాయిస్ ఆపండి", "మాట్లాడటం ఆపు", "మాట్లాడడం ఆపండి", "వినడం ఆపు", "వినడం ఆపండి"
    ]);
    const DESKTOP_AGENT_URL = "http://127.0.0.1:43187";
    let desktopSessionToken = null;
    let activeUtterance = null;
    let activeSpeakButton = null;
    let voiceConversationActive = false;
    let voiceTurnPending = false;
    let recognitionStarting = false;
    let voiceRestartTimer = null;
    const API_KEY_STORAGE = "jarvis_api_key";
    const BACKEND_HEALTH_URL = "https://jarvis-mobile-edition-alpha.vercel.app/api/health";
    const BACKEND_COMMAND_URL = "https://jarvis-mobile-edition-alpha.vercel.app/api/command";
    const INTERACTION_URL = "https://jarvis-mobile-edition-alpha.vercel.app/api/interaction/analyze";
    function conversationPreferences() { try { return Object.assign({}, JSON.parse(localStorage.getItem("kalki.preferences") || "{}"), JSON.parse(localStorage.getItem("kalki.conversation") || "{}")); } catch (_) { return {}; } }
    async function analyzeInteraction(text) {
        try { const prefs = conversationPreferences(); const r = await fetch(INTERACTION_URL, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text, messages:readMemory().slice(-12), profile:{displayName:prefs.name||"", language:prefs.language||"auto", responseStyle:prefs.style||"short"}, preferences:{askFollowUps:prefs.followUps !== false}})}); return r.ok ? await r.json() : null; } catch (_) { return null; }
    }

    async function sendBackendCommand(text) {
        const response = await fetch(BACKEND_COMMAND_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
            throw new Error(data.message || "Backend command bridge unavailable.");
        }
        return data.result || {};
    }

    async function checkBackendStatus() {
        try {
            await fetch(BACKEND_HEALTH_URL, { cache: "no-store" });
        } catch (_) {
            // Keep connection diagnostics out of the conversation surface.
        }
    }

    // Fallback models: first one busy ayithe next model try avutundi
    const MODEL_NAMES = [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite"
    ];

    let recognition = null;
    let isListening = false;

    function readMemory() {
        try {
            return JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
        } catch (error) {
            return [];
        }
    }

    function saveMemory(memory) {
        localStorage.setItem(
            MEMORY_KEY,
            JSON.stringify(memory.slice(-30))
        );
    }

    function addToMemory(sender, text, type) {
        const memory = readMemory();
        memory.push({ sender, text, type });
        saveMemory(memory);
    }

    function showMessage(sender, text, type, save = true) {
        if (!chatBox) return;

        const message = document.createElement("div");
        message.className = type === "user" ? "msg user" : "msg";

        const senderElement = document.createElement("strong");
        const displaySender = sender === "J.A.R.V.I.S" ? "KALKI" : sender;
        senderElement.textContent = `${displaySender}: `;

        message.appendChild(senderElement);
        message.appendChild(document.createTextNode(text));
        const canSpeak = type === "ai" && sender !== "SYSTEM" && sender !== "YOU";
        let speakButton = null;
        if (canSpeak) {
            speakButton = document.createElement("button");
            speakButton.type = "button";
            speakButton.className = "speak-button";
            speakButton.textContent = "🔊 Read aloud";
            speakButton.setAttribute("aria-label", `Read ${displaySender}'s reply aloud`);
            speakButton.setAttribute("aria-pressed", "false");
            speakButton.addEventListener("click", () => {
                if (activeSpeakButton === speakButton && window.speechSynthesis?.speaking) stopSpeaking();
                else speak(text, speakButton);
            });
            message.appendChild(speakButton);
        }

        chatBox.appendChild(message);
        document.body.classList.toggle("has-conversation", chatBox.children.length > 0);
        chatBox.scrollTop = chatBox.scrollHeight;

        if (save) addToMemory(sender, text, type);
        if (save && canSpeak && (ttsAutoRead?.checked || voiceConversationActive)) speak(text, speakButton);
    }

    function loadSavedChat() {
        const memory = readMemory();
        const transientStatus = new Set([
            "System online. AI brain ready.",
            "Secure backend and WhatsApp bridge online. Explicit commands only.",
            "Backend online. WhatsApp bridge is not connected.",
            "Backend connection unavailable. Local AI mode active."
        ]);
        memory.forEach((item) => {
            if (transientStatus.has(String(item.text || "").trim())) return;
            const sender = item.sender === "J.A.R.V.I.S" ? "KALKI" : item.sender;
            showMessage(sender || "KALKI", item.text || "", item.type || "ai", false);
        });
    }

    function getApiKey() {
        try { return (localStorage.getItem(API_KEY_STORAGE) || "").trim(); }
        catch (_) { return ""; }
    }

    function setApiKeyStatus(message, state = "") {
        if (!apiKeyStatus) return;
        apiKeyStatus.textContent = message;
        apiKeyStatus.classList.toggle("is-saved", state === "saved");
        apiKeyStatus.classList.toggle("is-error", state === "error");
    }

    function refreshApiKeyStatus() {
        if (apiKeyInput) apiKeyInput.value = ""; // Never place a saved secret back into the visible field.
        setApiKeyStatus(getApiKey()
            ? "Key saved locally · not verified with Google."
            : "No key saved on this device.", getApiKey() ? "saved" : "");
    }

    function saveApiKey() {
        const value = apiKeyInput?.value.trim() || "";
        if (!value) {
            setApiKeyStatus("Enter your Gemini API key first. Nothing was saved.", "error");
            apiKeyInput?.focus();
            return;
        }
        // Shape check only. This neither contacts Google nor authenticates the key.
        const plausibleGeminiKey = /^(?:AIza[A-Za-z0-9_-]{20,96}|AQ\.[A-Za-z0-9_-]{20,96})$/.test(value);
        if (!plausibleGeminiKey) {
            setApiKeyStatus("Use a standard AIza… key or an AI Studio authorization key starting AQ. This local format check does not verify the key with Google. Nothing was saved.", "error");
            apiKeyInput?.focus();
            return;
        }
        try {
            localStorage.setItem(API_KEY_STORAGE, value);
            if (apiKeyInput) apiKeyInput.value = "";
            setApiKeyStatus("Key saved locally · format looks plausible only; Google has not verified it.", "saved");
        } catch (_) {
            setApiKeyStatus("Could not save in this browser. Check device storage settings and try again.", "error");
        }
    }

    function clearApiKey() {
        try { localStorage.removeItem(API_KEY_STORAGE); }
        catch (_) { setApiKeyStatus("Could not clear browser-local storage.", "error"); return; }
        if (apiKeyInput) apiKeyInput.value = "";
        setApiKeyStatus("Saved key cleared from this browser/device.");
    }

    function openApiKeySettings() {
        if (voiceSettings) voiceSettings.hidden = false;
        if (settingsToggle) settingsToggle.setAttribute("aria-expanded", "true");
        document.body.classList.add("menu-open");
        setApiKeyStatus("A Gemini API key is required for AI chat replies. Add it here to continue.", "error");
        window.setTimeout(() => {
            apiKeySettings?.scrollIntoView({ behavior: "smooth", block: "center" });
            apiKeyInput?.focus({ preventScroll: true });
        }, 180);
    }

    async function askGemini(interaction = null) {
        const apiKey = getApiKey();

        if (!apiKey) {
            throw new Error("API key enter cheyyaledu.");
        }

        const contents = readMemory()
            .filter((item) => item.type === "user" || item.type === "ai")
            .slice(-20)
            .map((item) => ({
                role: item.type === "user" ? "user" : "model",
                parts: [{ text: item.text }]
            }));

        const apiBase =
            "https://generativelanguage.googleapis.com/v1beta/models/";

        let lastError = "AI connection failed.";

        for (const modelName of MODEL_NAMES) {
            try {
                const apiUrl = apiBase + modelName + ":generateContent";

                const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-goog-api-key": apiKey
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [{
                                text: `You are KALKI, a warm personal assistant who speaks naturally like a helpful friend, not a robotic list generator. Acknowledge statements, show empathy for emotions, ask at most one relevant follow-up when useful, clarify incomplete requests, and offer one sensible next step. Use Telugu/Teluglish naturally when the user does. Never invent calendar, task, weather, connector, or memory facts. Never claim durable memory beyond the conversation supplied. External actions remain explicit and confirmation-gated; do not send, schedule, or act in the background. ${interaction?.guidance?.tone || "Match the user’s language naturally."} ${interaction?.guidance?.style === "detailed" ? "Give a helpful explanation." : "Prefer concise, human replies."} Recent-context available: ${Boolean(interaction?.signals?.continuityAvailable)}.`
                            }]
                        },
                        contents
                    })
                });

                const data = await response.json();

                if (response.ok) {
                    const reply =
                        data?.candidates?.[0]?.content?.parts?.[0]?.text;

                    if (reply) return reply;
                    lastError = "AI nundi reply raledu.";
                    continue;
                }

                lastError =
                    data?.error?.message || "AI connection failed.";

                const temporaryProblem =
                    /high demand|temporar|quota|rate|unavailable|overload|busy|deprecated|not found/i;

                if (!temporaryProblem.test(lastError)) {
                    break;
                }
            } catch (error) {
                lastError = error.message;
            }
        }

        throw new Error(lastError);
    }

    function resetSpeakButton() {
        if (activeSpeakButton?.isConnected) {
            activeSpeakButton.textContent = "🔊 Read aloud";
            activeSpeakButton.setAttribute("aria-pressed", "false");
        }
        activeSpeakButton = null;
        activeUtterance = null;
    }

    function stopSpeaking(resumeVoice = true) {
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        resetSpeakButton();
        if (resumeVoice && voiceConversationActive) scheduleVoiceListening(350);
    }

    function speak(text, button = null) {
        if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
            if (ttsStatus) ttsStatus.textContent = "Text-to-speech is not supported by this browser.";
            if (voiceConversationActive) scheduleVoiceListening(500);
            return;
        }
        stopSpeaking(false);
        if (voiceConversationActive && isListening && recognition) {
            try { recognition.stop(); } catch (_) { /* Already stopped by the browser. */ }
        }
        const utterance = new SpeechSynthesisUtterance(String(text));
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice = getSelectedTtsVoice(voices);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
            utterance.lang = selectedVoice.lang || "en-IN";
        } else {
            const hasTeluguScript = Array.from(String(text)).some((character) => {
                const codePoint = character.codePointAt(0) || 0;
                return codePoint >= 0x0C00 && codePoint <= 0x0C7F;
            });
            utterance.lang = hasTeluguScript ? "te-IN" : "en-IN";
        }
        utterance.rate = 0.96;
        activeUtterance = utterance;
        activeSpeakButton = button;
        if (button) {
            button.textContent = "⏹ Stop";
            button.setAttribute("aria-pressed", "true");
        }
        utterance.onend = () => {
            if (activeUtterance !== utterance) return;
            resetSpeakButton();
            if (voiceConversationActive) scheduleVoiceListening(550);
        };
        utterance.onerror = () => {
            if (activeUtterance !== utterance) return;
            resetSpeakButton();
            if (voiceConversationActive) scheduleVoiceListening(700);
        };
        window.speechSynthesis.speak(utterance);
    }

    // Skill router: no background actions. A skill runs only after an explicit command.
    const SKILL_REGISTRY = {
        whatsapp: { name: "WhatsApp", keywords: /\bwhatsapp|message|reply|chat\b/i },
        youtube: { name: "YouTube", keywords: /\b(youtube|video)\b/i },
        search: { name: "Web Search", keywords: /\b(search|google|web|news|weather)\b/i },
        email: { name: "Email", keywords: /\b(email|mail|gmail|outlook)\b/i },
        calendar: { name: "Calendar", keywords: /\b(calendar|schedule|meeting|event)\b/i },
        tasks: { name: "Tasks and Reminders", keywords: /\b(task|reminder|todo)\b/i },
        drive: { name: "Cloud Files", keywords: /\b(drive|file|folder|upload|download)\b/i },
        documents: { name: "Documents", keywords: /\b(pdf|word|docx|excel|xlsx|spreadsheet|powerpoint|pptx)\b/i },
        travel: { name: "Travel", keywords: /\b(flight|hotel|travel|trip)\b/i },
        places: { name: "Places and Restaurants", keywords: /\b(restaurant|place|shop|directions)\b/i },
        prices: { name: "Price Comparison", keywords: /\b(price|cost|cheap|compare|buy)\b/i },
        media: { name: "Image and Media", keywords: /\b(image|photo|picture|edit)\b/i },
        automation: { name: "Multi-step Automation", keywords: /\b(automate|automation|workflow)\b/i },
        memory: { name: "Personal Memory", keywords: /\b(remember|memory|save this)\b/i }
    };

    function detectSkill(text) {
        return Object.entries(SKILL_REGISTRY)
            .find(([, skill]) => skill.keywords.test(text))?.[0] || null;
    }
    function normalizeVoiceStopPhrase(text) {
        return String(text || "").normalize("NFC").toLowerCase()
            .replace(/^\s*(?:kalki|కల్కి)[,\s]*/i, "")
            .replace(/[.,!?;:…]+/g, " ")
            .replace(/\s+/g, " ").trim()
            .replace(/\s+(?:please|now)$/i, "").trim();
    }
    function detectEverydayTool(text) {
        if (/\b(time|what time|samayam)\b/i.test(text)) return "time";
        if (/\b(weather|temperature|varsham)\b/i.test(text)) return "weather";
        if (/\b(timer|countdown|alarm)\b/i.test(text)) return "timer";
        if (/\b(dice|roll|coin|flip|head|tail)\b/i.test(text)) return "dice";
        if (/\b(joke|funny)\b/i.test(text)) return "joke";
        if (/\b(motivat|inspire|quote)\b/i.test(text)) return "motivation";
        if (/\b(tech news|ai news)\b/i.test(text)) return "techNews";
        if (/\b(translate|telugu lo)\b/i.test(text)) return "translate";
        if (/\b(currency|convert|exchange rate|rupees?|inr|dollar)\b/i.test(text)) return "currency";
        if (/\b(meaning|define|dictionary)\b/i.test(text)) return "meaning";
        if (/\b(password)\b/i.test(text)) return "password";
        if (/\b(wikipedia|wiki)\b/i.test(text)) return "wikipedia";
        if (/\b(open|launch)\s+(youtube|yt)\b/i.test(text)) return "openYouTube";
        if (/\b(open|launch)\s+google\b/i.test(text)) return "openGoogle";
        if (/\b(youtube)\b.*\b(song|search|play)\b/i.test(text)) return "youtubeSearch";
        if (/\b(bitcoin|btc)\b/i.test(text)) return "bitcoin";
        return null;
    }

    // Normalize common English–Telugu (and Telugu transliteration) phrases before routing.
    function normalizeCommand(text) {
        return text.trim()
            .replace(/\b(chey|cheyyi|cheyyandi|kavali)\b/gi, "do")
            .replace(/\b(teruvu|open\s+chey|open\s+cheyyi)\b/gi, "open")
            .replace(/\b(pampu|pampinch(u|andi)?|send\s+chey)\b/gi, "send")
            .replace(/\b(cheppu|chepp(u|andi)?|teliyajey)\b/gi, "tell me")
            .replace(/\b(latest)\s+AI\s+(news|vishayalu)\b/gi, "search latest AI news")
            .replace(/\s+/g, " ").trim();
    }

    function isExplicitAction(te
