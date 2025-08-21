'use strict'

const fs = require('fs');
const path = require('path');

// Ensure fetch exists (Node < 18 polyfill)
if (typeof fetch === 'undefined') {
    global.fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
}

const DEFAULT_PROMPT = (
    "Generate a new intermediate-level Japanese sentence, use grammatical concepts from N1-N3, with this exact structure:\n\n" +
    "漢字: [sentence]\n" +
    "ひらがな: [reading]\n" +
    "Romaji: [romaji]\n" +
    "Breakdown: [word-by-word]\n" +
    "Grammar: [explanation]\n" +
    "Meaning: [english]\n\n" +
    "Example:\n" +
    "漢字: 先生が説明を簡潔にまとめた。\n" +
    "ひらがな: せんせいが せつめいを かんけつに まとめた。\n" +
    "Romaji: Sensei ga setsumei o kanketsu ni matometa.\n" +
    "Breakdown: 先生（せんせい）（teacher） + が（が）（subject） + 説明（せつめい）（explanation） + を（を）（object） + 簡潔に（かんけつに）（concisely） + まとめた（まとめた）（summarized）\n" +
    "Grammar: ～にまとめた = 'summarized into...'\n" +
    "Meaning: The teacher summarized the explanation concisely\n" +
    "new line for each word\n" +
    "new line for each grammar\n" +
    "Breakdown and Grammar formatting should be the same. Each grammar doesn't need a new 'Grammar:' in front. 'Grammar:' is only allowed one time!\n" +
    "Also please don't add any questions or unnecessary commentary\n" +
    "Remember, use grammatical structures that an adult would need, not too simple"
);

function getPrompt(source, target) {
    const promptPath = path.join(__dirname, '..', 'resources', 'prompts', `${source}_${target}.txt`);
    try {
        if (fs.existsSync(promptPath)) {
            return fs.readFileSync(promptPath, 'utf8');
        }
    } catch (_) {}
    return DEFAULT_PROMPT;
}

function normalizeMultiline(text) {
    if (!text || typeof text !== 'string') return '';
    if (text.includes('\n')) return text;
    const parts = text.split(/\s*\+\s*/u);
    if (parts && parts.length > 1) return parts.map(s => s.trim()).join('\n');
    return text;
}

function parseResponse(data, source, target) {
    const content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const sourceTarget = `${String(source).toLowerCase()}_${String(target).toLowerCase()}`;

    // Remove bold ** **
    const cleaned = content.replace(/\*\*(.*?)\*\*/g, '$1');

    if (sourceTarget === 'japanese_english') {
        const m = cleaned.match(/^English:\s*(.*?)\n読み方:\s*(.*?)\nWord Breakdown:\s*(.*?)\nGrammar:\s*(.*?)\nMeaning:\s*(.*)/s);
        if (m) {
            return {
                kanji: m[1],
                hiragana: m[2],
                romaji: '',
                breakdown: normalizeMultiline((m[3] || '').trim()),
                grammar: normalizeMultiline((m[4] || '').trim()),
                meaning: (m[5] || '').trim()
            };
        }
    }

    // english_japanese (default)
    const m = cleaned.match(/漢字:\s*(.*?)\nひらがな:\s*(.*?)\nRomaji:\s*(.*?)\nBreakdown:\s*(.*?)\nGrammar:\s*(.*?)\nMeaning:\s*(.*)/s);
    if (m) {
        return {
            kanji: (m[1] || '').trim(),
            hiragana: (m[2] || '').trim(),
            romaji: (m[3] || '').trim(),
            breakdown: normalizeMultiline((m[4] || '').trim()),
            grammar: normalizeMultiline((m[5] || '').trim()),
            meaning: (m[6] || '').trim()
        };
    }

    return getFallbackSentence(source, target);
}

function getFallbackSentence(source, target) {
    return {
        kanji: '今日は雨が降っています',
        hiragana: 'きょうは あめが ふっています',
        romaji: 'Kyō wa ame ga futte imasu',
        breakdown: '今日 (today) + は (topic) + 雨 (rain) + が (subject) + 降っています (is falling)',
        grammar: '〜ています = ongoing action',
        meaning: 'It is raining today'
    };
}

async function fetchFromDeepSeek(source, target) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');
    const body = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: getPrompt(source, target) }]
    };
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        // 15s timeout via AbortController if needed by callers
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`DeepSeek error ${res.status}: ${errText}`);
    }
    return res.json();
}

// Simple in-memory cache with TTL
const cache = new Map();
function cacheKey(source, target) { return `daily_sentence_${source}_to_${target}`; }

async function generateSentence(source, target) {
    const key = cacheKey(source, target);
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    try {
        const data = await fetchFromDeepSeek(source, target);
        const parsed = parseResponse(data, source, target);
        cache.set(key, { value: parsed, expiresAt: now + 12 * 60 * 60 * 1000 });
        return parsed;
    } catch (_) {
        return getFallbackSentence(source, target);
    }
}

module.exports = { generateSentence };


